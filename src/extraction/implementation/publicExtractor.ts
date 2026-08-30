import {
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  UnknownExtractionError,
} from "../../errors/errorTypes.js";
import { isRedirectBlock } from "./redirectBlock.js";
import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawProfileData } from "../../types/profile.types.js";

// No-login fallback: LinkedIn embeds schema.org JSON-LD on public profile
// pages for search-engine indexing. No cookies needed, but far less data
// than the authenticated Voyager extractor — experience/education/skills/
// certifications/languages aren't exposed to anonymous visitors, so those
// keys are simply omitted (per the formatter's existing omission convention).
const JSON_LD_RE = /<script type="application\/ld\+json">(.*?)<\/script>/s;

interface JsonLdPerson {
  name?: string;
  jobTitle?: string;
  description?: string;
  image?: string | { contentUrl?: string };
  address?: { addressLocality?: string; addressRegion?: string };
}

export const publicExtractor: ProfileExtractor = {
  async fetch(normalizedUrl: string): Promise<RawProfileData> {
    let res: Response;
    try {
      res = await fetch(normalizedUrl, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          accept: "text/html",
          "accept-language": "en-US,en;q=0.9",
          "sec-fetch-site": "none",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      });
    } catch (err) {
      if (isRedirectBlock(err)) {
        throw new UpstreamRateLimitedError("LinkedIn blocked the request with an infinite redirect (edge-level automated-traffic block)");
      }
      throw new UnknownExtractionError(`Network error fetching profile page: ${(err as Error).message}`);
    }

    if (res.status === 404) throw new ProfileNotFoundError();
    if (res.status === 403 || res.status === 999) {
      throw new UpstreamRateLimitedError("LinkedIn rejected the anonymous request (blocked or rate-limited)");
    }
    if (!res.ok) throw new UnknownExtractionError(`LinkedIn returned HTTP ${res.status}`);

    const html = await res.text();
    const match = html.match(JSON_LD_RE);
    if (!match) throw new ProfilePrivateOrUnreachableError();

    let person: JsonLdPerson;
    try {
      person = JSON.parse(match[1]);
    } catch {
      throw new ProfilePrivateOrUnreachableError();
    }

    // A found-but-empty JSON-LD block usually means LinkedIn served a generic/auth-wall
    // page to this anonymous request rather than the real profile — treat as unreachable
    // rather than returning a hollow "success" with no actual name.
    if (!person.name) throw new ProfilePrivateOrUnreachableError();

    const image = typeof person.image === "string" ? person.image : (person.image?.contentUrl ?? null);

    return {
      name: person.name,
      headline: person.jobTitle ?? null,
      location: person.address?.addressLocality ?? person.address?.addressRegion ?? null,
      about: person.description ?? null,
      profilePhotoUrl: image,
    };
  },
};
