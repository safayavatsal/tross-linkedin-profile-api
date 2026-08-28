import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VOYAGER_FIXTURE = {
  included: [
    {
      $type: "com.linkedin.voyager.identity.profile.Profile",
      firstName: "Jane",
      lastName: "Doe",
      headline: "Senior Engineer",
      locationName: "Bengaluru, India",
      summary: "About text.",
      profilePicture: {
        rootUrl: "https://media.licdn.com/dms/image/",
        artifacts: [
          { width: 100, fileIdentifyingUrlPathSegment: "small.jpg" },
          { width: 400, fileIdentifyingUrlPathSegment: "large.jpg" },
        ],
      },
    },
    {
      $type: "com.linkedin.voyager.identity.profile.Position",
      title: "Senior Engineer",
      companyName: "Example Co.",
      locationName: "Bengaluru, India",
      description: "Did things.",
      timePeriod: { startDate: { year: 2022 } },
    },
    {
      $type: "com.linkedin.voyager.identity.profile.Education",
      schoolName: "Example University",
      degreeName: "B.Tech",
      timePeriod: { startDate: { year: 2016 }, endDate: { year: 2020 } },
    },
    { $type: "com.linkedin.voyager.identity.profile.Skill", name: "TypeScript" },
    {
      $type: "com.linkedin.voyager.identity.profile.Certification",
      name: "Example Cert",
      authority: "Example Org",
      timePeriod: { startDate: { year: 2023 } },
    },
    { $type: "com.linkedin.voyager.identity.profile.Language", name: "English" },
  ],
};

describe("linkedinExtractor", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    process.env.LINKEDIN_LI_AT = "test-li-at";
    process.env.LINKEDIN_JSESSIONID = "test-jsessionid";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.LINKEDIN_LI_AT;
    delete process.env.LINKEDIN_JSESSIONID;
  });

  it("parses a Voyager profileView response into RawProfileData", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => VOYAGER_FIXTURE,
    }) as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const raw = await linkedinExtractor.fetch("https://www.linkedin.com/in/jane-doe");

    expect(raw.name).toBe("Jane Doe");
    expect(raw.headline).toBe("Senior Engineer");
    expect(raw.experience).toEqual([
      {
        title: "Senior Engineer",
        company: "Example Co.",
        duration: "2022 - Present",
        location: "Bengaluru, India",
        description: "Did things.",
      },
    ]);
    expect(raw.education?.[0]).toEqual({ school: "Example University", degree: "B.Tech", duration: "2016 - 2020" });
    expect(raw.skills).toEqual(["TypeScript"]);
    expect(raw.certifications?.[0]).toEqual({ name: "Example Cert", issuer: "Example Org", date: "2023" });
    expect(raw.languages).toEqual(["English"]);
    expect(raw.profilePhotoUrl).toBe("https://media.licdn.com/dms/image/large.jpg");
  });

  it("maps a 404 to ProfileNotFoundError", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const { ProfileNotFoundError } = await import("../../src/errors/errorTypes.js");

    await expect(linkedinExtractor.fetch("https://www.linkedin.com/in/nobody")).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
  });

  it("maps a 999 (LinkedIn block response) to UpstreamRateLimitedError", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 999 }) as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const { UpstreamRateLimitedError } = await import("../../src/errors/errorTypes.js");

    await expect(linkedinExtractor.fetch("https://www.linkedin.com/in/blocked")).rejects.toBeInstanceOf(
      UpstreamRateLimitedError,
    );
  });

  it("maps a redirect-loop network failure (LinkedIn's edge block) to UpstreamRateLimitedError", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: new Error("redirect count exceeded") }),
    ) as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const { UpstreamRateLimitedError } = await import("../../src/errors/errorTypes.js");

    await expect(linkedinExtractor.fetch("https://www.linkedin.com/in/blocked")).rejects.toBeInstanceOf(
      UpstreamRateLimitedError,
    );
  });
});
