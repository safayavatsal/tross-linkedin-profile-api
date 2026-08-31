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
import { fetchFlightComponent, parseFlightResponse, type FlightSection } from "./linkedinFlightProtocol.js";
import {
  parseAbout,
  parseExperience,
  parseEducation,
  parseSkills,
  parseCertifications,
  parseLanguages,
} from "./linkedinSectionParsers.js";
import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawProfileData } from "../../types/profile.types.js";

// Real extraction via LinkedIn's internal "Voyager" web API. The classic
// `identity/profiles/{id}/profileView` REST endpoint is dead (410 Gone, confirmed
// during this build). This targets its still-alive sibling instead: the Voyager
// "Dash" layer's decorated top-card finder — found via Wayfinder ticket T2
// (verified from cullenwatson/StaffSpy's source, not just README claims). Deeper
// sections (about/experience/education/skills/certifications/languages) come from a
// completely different system — LinkedIn's "Flight protocol" component actions (see
// linkedinFlightProtocol.ts) — since the old Voyager GraphQL section query this
// project used before is dead too (confirmed live: HTTP 500 from LinkedIn's own
// backend, T12).
//
// Top-card response shape (fields below) is now confirmed against a real, live
// response (T7/T12): the top-level body is `{data, included}`, not `{elements}` —
// `included` is a flat bag of entities, and the actual profile record is the one
// whose `$recipeTypes` names `TopCardComplete`. `firstName`/`headline` are plain
// fields on that entity, but a human-readable location isn't: `locationName`/
// `geoLocationName` don't exist on this decoration, only `location.countryCode`
// (e.g. "IN") and a `geoLocation["*geo"]` urn pointing at a *separate* entity
// elsewhere in `included` whose `defaultLocalizedName` holds the real string
// (e.g. "Mumbai, Maharashtra, India"). The photo is nested one level deeper than
// guessed too: `profilePicture.displayImageReference.vectorImage.{rootUrl,artifacts}`.
// Unofficial/reverse-engineered (docs/08_Risk_Limitations.md) — can change or get
// rate-limited/flagged at any time.
type DashEntity = Record<string, unknown>;

function publicIdentifierFromUrl(normalizedUrl: string): string {
  return new URL(normalizedUrl).pathname.replace(/^\/in\//, "").replace(/\/$/, "");
}

function findTopCardEntity(included: DashEntity[]): DashEntity | undefined {
  return included.find((e) => (e.$recipeTypes as string[] | undefined)?.some((r) => r.includes("TopCardComplete")));
}

function resolveLocationName(entity: DashEntity, included: DashEntity[]): string | null {
  const geoLocation = entity.geoLocation as { ["*geo"]?: string } | undefined;
  if (geoLocation?.["*geo"]) {
    const geoEntity = included.find((e) => e.entityUrn === geoLocation["*geo"]);
    const name = geoEntity?.defaultLocalizedName as string | undefined;
    if (name) return name;
  }
  const location = entity.location as { countryCode?: string } | undefined;
  return location?.countryCode ?? null;
}

function pickImageUrl(picture: unknown): string | null {
  const vectorImage = (
    picture as { displayImageReference?: { vectorImage?: { rootUrl?: string; artifacts?: { width: number; fileIdentifyingUrlPathSegment: string }[] } } } | undefined
  )?.displayImageReference?.vectorImage;
  if (!vectorImage?.rootUrl || !vectorImage.artifacts?.length) return null;
  const largest = [...vectorImage.artifacts].sort((a, b) => b.width - a.width)[0];
  return vectorImage.rootUrl + largest.fileIdentifyingUrlPathSegment;
}

function extractTopCard(included: DashEntity[]): RawProfileData {
  const e = findTopCardEntity(included);
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
    location: resolveLocationName(e, included),
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

    const body = (await res.json()) as { included?: DashEntity[] };
    const profile = extractTopCard(body.included ?? []);

    // Fired together, not paced 10s apart like separate profile requests: this mirrors how a
    // real browser loads a profile page (one navigation triggers several near-simultaneous
    // requests) — spacing these out would look more automated, not less. The pacing gate above
    // already governs the rate of *separate profile fetches*; this is one logical fetch. Any
    // individual section failing (wrong componentId after LinkedIn's next rebuild, transient
    // 500, etc.) just means that one section stays unpopulated — never fails the whole request.
    const sections = ["about", "experience", "education", "skills", "certifications", "languages"] as const;
    const [about, experience, education, skills, certifications, languages] = await Promise.allSettled(
      sections.map((section: FlightSection) =>
        fetchFlightComponent(publicIdentifier, section).then(parseFlightResponse),
      ),
    );

    if (about.status === "fulfilled") profile.about = parseAbout(about.value);
    if (experience.status === "fulfilled") profile.experience = parseExperience(experience.value);
    if (education.status === "fulfilled") profile.education = parseEducation(education.value);
    if (skills.status === "fulfilled") profile.skills = parseSkills(skills.value);
    if (certifications.status === "fulfilled") profile.certifications = parseCertifications(certifications.value);
    if (languages.status === "fulfilled") profile.languages = parseLanguages(languages.value);

    return profile;
  },
};
