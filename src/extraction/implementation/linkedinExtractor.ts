import { config } from "../../config/index.js";
import {
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  UnknownExtractionError,
} from "../../errors/errorTypes.js";
import { isRedirectBlock } from "./redirectBlock.js";
import { msUntilAllowed, recordAttempt, recordBlock } from "./linkedinPacing.js";
import {
  topCardUrl,
  profileComponentsBySectionTypeUrl,
  profileTabInitialCardsUrl,
  findProfileUrnId,
} from "./linkedinDashEndpoints.js";
import {
  parseExperience,
  parseEducation,
  parseSkills,
  parseCertifications,
  parseLanguages,
  parseBio,
} from "./linkedinSectionParsers.js";
import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawProfileData } from "../../types/profile.types.js";

// Real extraction via LinkedIn's internal "Voyager" web API. The classic
// `identity/profiles/{id}/profileView` REST endpoint is dead (410 Gone, confirmed
// during this build). This targets its still-alive sibling instead: the Voyager
// "Dash" layer's decorated top-card finder — found via Wayfinder ticket T2
// (verified from cullenwatson/StaffSpy's source, not just README claims). If the
// top-card response yields a profile urn, also fetches experience/education/skills/
// certifications/languages/bio — field mappings sourced from T11's read of
// StaffSpy's actual parsing code (linkedinSectionParsers.ts), not guessed. None of
// this has been confirmed live against our own account (T7 remains blocked).
// Unofficial/reverse-engineered (docs/08_Risk_Limitations.md) — can change or get
// rate-limited/flagged at any time.
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

function authHeaders(normalizedUrl: string): Record<string, string> {
  return {
    cookie: `li_at=${config.linkedinLiAt}; JSESSIONID="${config.linkedinJsessionid}"`,
    "csrf-token": config.linkedinJsessionid as string,
    "x-restli-protocol-version": "2.0.0",
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "en-US,en;q=0.9",
    referer: normalizedUrl,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
}

// Best-effort follow-up call for one profile section (experience/education/.../bio) once the
// top-card call already succeeded. Any failure here (network, block signal, unexpected shape)
// just means that one section stays unpopulated — never fails the whole request (see T8/T11).
async function fetchDashJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (isRedirectBlock(err)) recordBlock();
    throw err;
  }
  if (res.status === 401 || res.status === 403 || res.status === 999) {
    recordBlock();
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    const headers = authHeaders(normalizedUrl);
    let res: Response;
    try {
      res = await fetch(topCardUrl(publicIdentifier), { headers });
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
    const profile = extractTopCard(body.elements ?? []);

    // The section/bio calls need the profile's internal urn id, only present inside the
    // top-card response. If we can't find it, we still have a valid top-card result — return
    // it as-is rather than failing the whole request over the additional sections.
    const profileUrnId = findProfileUrnId(body);
    if (!profileUrnId) return profile;

    // Fired together, not paced 10s apart like separate profile requests: this mirrors how a
    // real browser loads a profile page (one navigation triggers several near-simultaneous XHR
    // calls) — spacing these out would look more automated, not less. The pacing gate above
    // already governs the rate of *separate profile fetches*; this is one logical fetch.
    const [bio, experience, education, skills, certifications, languages] = await Promise.allSettled([
      fetchDashJson(profileTabInitialCardsUrl(profileUrnId), headers).then(parseBio),
      fetchDashJson(profileComponentsBySectionTypeUrl(profileUrnId, "experience"), headers).then(parseExperience),
      fetchDashJson(profileComponentsBySectionTypeUrl(profileUrnId, "education"), headers).then(parseEducation),
      fetchDashJson(profileComponentsBySectionTypeUrl(profileUrnId, "skills"), headers).then(parseSkills),
      fetchDashJson(profileComponentsBySectionTypeUrl(profileUrnId, "certifications"), headers).then(parseCertifications),
      fetchDashJson(profileComponentsBySectionTypeUrl(profileUrnId, "languages"), headers).then(parseLanguages),
    ]);

    if (bio.status === "fulfilled" && bio.value) profile.about = bio.value;
    if (experience.status === "fulfilled") profile.experience = experience.value;
    if (education.status === "fulfilled") profile.education = education.value;
    if (skills.status === "fulfilled") profile.skills = skills.value;
    if (certifications.status === "fulfilled") profile.certifications = certifications.value;
    if (languages.status === "fulfilled") profile.languages = languages.value;

    return profile;
  },
};
