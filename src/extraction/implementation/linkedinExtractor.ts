import { config } from "../../config/index.js";
import {
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  UnknownExtractionError,
} from "../../errors/errorTypes.js";
import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawProfileData } from "../../types/profile.types.js";

// Real extraction via LinkedIn's internal "Voyager" web API — the same one
// linkedin.com's own frontend calls once you're logged in. Requires your own
// session cookies (LINKEDIN_LI_AT + LINKEDIN_JSESSIONID, see README). This is
// unofficial/reverse-engineered (docs/08_Risk_Limitations.md) — LinkedIn can
// change this shape or rate-limit/flag the account at any time.
type VoyagerEntity = Record<string, unknown> & { $type?: string };

function publicIdentifierFromUrl(normalizedUrl: string): string {
  return new URL(normalizedUrl).pathname.replace(/^\/in\//, "").replace(/\/$/, "");
}

function pickImageUrl(picture: unknown): string | null {
  const p = picture as { rootUrl?: string; artifacts?: { width: number; fileIdentifyingUrlPathSegment: string }[] } | undefined;
  if (!p?.rootUrl || !p.artifacts?.length) return null;
  const largest = [...p.artifacts].sort((a, b) => b.width - a.width)[0];
  return p.rootUrl + largest.fileIdentifyingUrlPathSegment;
}

function formatDuration(timePeriod: unknown): string {
  const tp = timePeriod as { startDate?: { year?: number }; endDate?: { year?: number } } | undefined;
  const start = tp?.startDate?.year ? String(tp.startDate.year) : "?";
  const end = tp?.endDate?.year ? String(tp.endDate.year) : "Present";
  return `${start} - ${end}`;
}

function byType(included: VoyagerEntity[], suffix: string): VoyagerEntity[] {
  return included.filter((e) => typeof e.$type === "string" && e.$type.endsWith(suffix));
}

export const linkedinExtractor: ProfileExtractor = {
  async fetch(normalizedUrl: string): Promise<RawProfileData> {
    if (!config.linkedinLiAt || !config.linkedinJsessionid) {
      throw new UnknownExtractionError("Real extraction not configured: set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID");
    }

    const publicIdentifier = publicIdentifierFromUrl(normalizedUrl);
    const res = await fetch(
      `https://www.linkedin.com/voyager/api/identity/profiles/${publicIdentifier}/profileView`,
      {
        headers: {
          cookie: `li_at=${config.linkedinLiAt}; JSESSIONID="${config.linkedinJsessionid}"`,
          "csrf-token": config.linkedinJsessionid,
          "x-restli-protocol-version": "2.0.0",
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    );

    if (res.status === 404) throw new ProfileNotFoundError();
    if (res.status === 401 || res.status === 403 || res.status === 999) {
      throw new UpstreamRateLimitedError("LinkedIn rejected the request (blocked, rate-limited, or session expired)");
    }
    if (!res.ok) throw new UnknownExtractionError(`LinkedIn returned HTTP ${res.status}`);

    const body = (await res.json()) as { included?: VoyagerEntity[] };
    const included = body.included ?? [];
    const profile = byType(included, "identity.profile.Profile")[0];
    if (!profile) throw new ProfilePrivateOrUnreachableError();

    const positions = byType(included, "identity.profile.Position");
    const educations = byType(included, "identity.profile.Education");
    const skills = byType(included, "identity.profile.Skill");
    const certifications = byType(included, "identity.profile.Certification");
    const languages = byType(included, "identity.profile.Language");

    return {
      name: `${(profile.firstName as string) ?? ""} ${(profile.lastName as string) ?? ""}`.trim(),
      headline: (profile.headline as string) ?? null,
      location: (profile.locationName as string) ?? null,
      about: (profile.summary as string) ?? null,
      experience: positions.map((p) => ({
        title: (p.title as string) ?? "",
        company: (p.companyName as string) ?? "",
        duration: formatDuration(p.timePeriod),
        location: (p.locationName as string) ?? null,
        description: (p.description as string) ?? null,
      })),
      education: educations.map((e) => ({
        school: (e.schoolName as string) ?? "",
        degree: (e.degreeName as string) ?? null,
        duration: formatDuration(e.timePeriod),
      })),
      skills: skills.map((s) => (s.name as string) ?? "").filter(Boolean),
      certifications: certifications.map((c) => ({
        name: (c.name as string) ?? "",
        issuer: (c.authority as string) ?? null,
        date: (c.timePeriod as { startDate?: { year?: number } } | undefined)?.startDate?.year
          ? String((c.timePeriod as { startDate: { year: number } }).startDate.year)
          : null,
      })),
      languages: languages.map((l) => (l.name as string) ?? "").filter(Boolean),
      profilePhotoUrl: pickImageUrl(profile.profilePicture),
      bannerUrl: pickImageUrl(profile.backgroundPicture),
    };
  },
};
