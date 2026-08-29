import { config } from "../../config/index.js";
import {
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  UnknownExtractionError,
} from "../../errors/errorTypes.js";
import { isRedirectBlock } from "./redirectBlock.js";
import { msUntilAllowed, recordAttempt, recordBlock } from "./linkedinPacing.js";
import { topCardUrl } from "./linkedinDashEndpoints.js";
import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawProfileData } from "../../types/profile.types.js";

// Real extraction via LinkedIn's internal "Voyager" web API. The classic
// `identity/profiles/{id}/profileView` REST endpoint is dead (410 Gone, confirmed
// during this build). This targets its still-alive sibling instead: the Voyager
// "Dash" layer's decorated top-card finder — found via internal ticket T2
// (verified from that project's source, not just README claims) and not
// yet confirmed live against our own account (that's ticket T7). Unofficial/
// reverse-engineered (docs/08_Risk_Limitations.md) — can change or get
// rate-limited/flagged at any time. Only returns top-card data (name, headline,
// location, photo) — not experience/education/skills, which live behind
// separate, still-unverified GraphQL calls (see T2-findings.md).
type DashEntity = Record<string, unknown>;

function publicIdentifierFromUrl(normalizedUrl: string): string {
  return new URL(normalizedUrl).pathname.replace(/^\/in\//, "").replace(/\/$/, "");
}

function pickImageUrl(picture: unknown): string | null {
  const p = picture as { rootUrl?: string; artifacts?: { width: number; fileIdentifyingUrlPathSegment: string }[] } | undefined;
  if (!p?.rootUrl || !p.artifacts?.length) return null;
  const largest = [...p.artifacts].sort((a, b) => b.width - a.width)[0];
  return p.rootUrl + largest.fileIdentifyingUrlPathSegment;
}

// Field names are our best-effort reading of typical Voyager/Dash naming
// conventions (mirrors the old Profile entity) — unverified until T7's live
// test. If LinkedIn's actual TopCardComplete shape differs, this throws with
// the real top-level keys so T7 can fix the mapping from real evidence.
function extractTopCard(elements: DashEntity[]): RawProfileData {
  const e = elements[0];
  if (!e) throw new ProfilePrivateOrUnreachableError();

  const firstName = (e.firstName as string) ?? "";
  const lastName = (e.lastName as string) ?? "";
  const name = `${firstName} ${lastName}`.trim() || (e.name as string) || "";
  if (!name) {
    throw new UnknownExtractionError(
      `Unexpected TopCardComplete shape, no name field found. Top-level keys: ${Object.keys(e).join(", ")}`,
    );
  }

  return {
    name,
    headline: (e.headline as string) ?? null,
    location: (e.locationName as string) ?? (e.geoLocationName as string) ?? null,
    about: null,
    profilePhotoUrl: pickImageUrl(e.profilePicture),
  };
}

export const linkedinExtractor: ProfileExtractor = {
  async fetch(normalizedUrl: string): Promise<RawProfileData> {
    if (!config.linkedinLiAt || !config.linkedinJsessionid) {
      throw new UnknownExtractionError("Real extraction not configured: set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID");
    }

    const wait = msUntilAllowed();
    if (wait > 0) {
      throw new UpstreamRateLimitedError(`Self-imposed pacing: wait ${Math.ceil(wait / 1000)}s before the next LinkedIn call`);
    }
    recordAttempt();

    const publicIdentifier = publicIdentifierFromUrl(normalizedUrl);
    let res: Response;
    try {
      res = await fetch(
        topCardUrl(publicIdentifier),
        {
          headers: {
            cookie: `li_at=${config.linkedinLiAt}; JSESSIONID="${config.linkedinJsessionid}"`,
            "csrf-token": config.linkedinJsessionid,
            "x-restli-protocol-version": "2.0.0",
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
      );
    } catch (err) {
      if (isRedirectBlock(err)) {
        recordBlock();
        throw new UpstreamRateLimitedError("LinkedIn blocked the request with an infinite redirect (edge-level automated-traffic block)");
      }
      throw new UnknownExtractionError(`Network error calling Voyager API: ${(err as Error).message}`);
    }

    if (res.status === 404) throw new ProfileNotFoundError();
    if (res.status === 401 || res.status === 403 || res.status === 999) {
      recordBlock();
      throw new UpstreamRateLimitedError("LinkedIn rejected the request (blocked, rate-limited, or session expired)");
    }
    if (!res.ok) throw new UnknownExtractionError(`LinkedIn returned HTTP ${res.status}`);

    const body = (await res.json()) as { elements?: DashEntity[] };
    return extractTopCard(body.elements ?? []);
  },
};
