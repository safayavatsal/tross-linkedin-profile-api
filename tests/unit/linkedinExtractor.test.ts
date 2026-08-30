import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TOPCARD_FIXTURE = {
  elements: [
    {
      firstName: "Jane",
      lastName: "Doe",
      headline: "Senior Engineer",
      locationName: "Bengaluru, India",
      profilePicture: {
        rootUrl: "https://media.licdn.com/dms/image/",
        artifacts: [
          { width: 100, fileIdentifyingUrlPathSegment: "small.jpg" },
          { width: 400, fileIdentifyingUrlPathSegment: "large.jpg" },
        ],
      },
    },
  ],
};

describe("linkedinExtractor", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Fresh module registry per test, so linkedinPacing's module-level gate
    // starts unthrottled each time (only shared within a single test's calls).
    vi.resetModules();
    process.env.LINKEDIN_LI_AT = "test-li-at";
    process.env.LINKEDIN_JSESSIONID = "test-jsessionid";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.LINKEDIN_LI_AT;
    delete process.env.LINKEDIN_JSESSIONID;
  });

  it("parses a TopCardComplete Dash response into RawProfileData", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TOPCARD_FIXTURE,
    }) as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const raw = await linkedinExtractor.fetch("https://www.linkedin.com/in/jane-doe");

    expect(raw.name).toBe("Jane Doe");
    expect(raw.headline).toBe("Senior Engineer");
    expect(raw.location).toBe("Bengaluru, India");
    expect(raw.profilePhotoUrl).toBe("https://media.licdn.com/dms/image/large.jpg");
    expect(raw.experience).toBeUndefined();
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

  it("throws with diagnostic info when the response shape has no name field", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ elements: [{ someUnexpectedField: true }] }),
    }) as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    await expect(linkedinExtractor.fetch("https://www.linkedin.com/in/weird-shape")).rejects.toThrow(
      /Unexpected TopCardComplete shape/,
    );
  });

  it("fetches sections/bio when the top-card response contains a profile urn, degrading gracefully on partial failure", async () => {
    const TOPCARD_WITH_URN = {
      elements: [{ ...TOPCARD_FIXTURE.elements[0], entityUrn: "urn:li:fsd_profile:ACoAAB123" }],
    };
    const experienceJson = {
      data: {
        identityDashProfileComponentsBySectionType: {
          elements: [
            {
              components: {
                pagedListComponent: {
                  components: {
                    elements: [
                      {
                        components: {
                          entityComponent: {
                            titleV2: { text: { text: "Senior Engineer" } },
                            subtitle: { text: "Acme Corp · Full-time" },
                            caption: { text: "Jan 2020 - Present" },
                            metadata: { text: "Remote" },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("voyagerIdentityDashProfiles?")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => TOPCARD_WITH_URN });
      }
      if (url.includes("sectionType:experience")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => experienceJson });
      }
      // Every other section/bio call fails — should be omitted, not fail the whole request.
      return Promise.resolve({ ok: false, status: 500 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const raw = await linkedinExtractor.fetch("https://www.linkedin.com/in/jane-doe");

    expect(raw.name).toBe("Jane Doe");
    expect(raw.experience).toEqual([
      { title: "Senior Engineer", company: "Acme Corp · Full-time", duration: "Jan 2020 - Present", location: "Remote", description: null },
    ]);
    expect(raw.education).toBeUndefined();
    expect(raw.skills).toBeUndefined();
    expect(raw.certifications).toBeUndefined();
    expect(raw.languages).toBeUndefined();
    expect(raw.about).toBeNull();
    // top-card + bio + experience + education + skills + certifications + languages = 7 calls
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("self-paces: a second call before the minimum interval is rejected without hitting the network", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => TOPCARD_FIXTURE,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { linkedinExtractor } = await import("../../src/extraction/implementation/linkedinExtractor.js");
    const { UpstreamRateLimitedError } = await import("../../src/errors/errorTypes.js");

    await linkedinExtractor.fetch("https://www.linkedin.com/in/jane-doe");
    await expect(linkedinExtractor.fetch("https://www.linkedin.com/in/jane-doe")).rejects.toBeInstanceOf(
      UpstreamRateLimitedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
