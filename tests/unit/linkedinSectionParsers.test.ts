import { describe, it, expect } from "vitest";
import {
  parseExperience,
  parseEducation,
  parseSkills,
  parseCertifications,
  parseLanguages,
  parseBio,
} from "../../src/extraction/implementation/linkedinSectionParsers.js";

// Fixtures shaped per internal notes' documented
// JSON paths (sourced from reading that project's actual parsing code) — not live LinkedIn data.

function pagedSection(elements: unknown[]) {
  return {
    data: {
      identityDashProfileComponentsBySectionType: {
        elements: [{ components: { pagedListComponent: { components: { elements } } } }],
      },
    },
  };
}

function entityElement(entityComponent: Record<string, unknown>) {
  return { components: { entityComponent } };
}

describe("parseExperience", () => {
  it("parses a single-position entry", () => {
    const json = pagedSection([
      entityElement({
        titleV2: { text: { text: "Senior Engineer" } },
        subtitle: { text: "Acme Corp · Full-time" },
        caption: { text: "Jan 2020 - Present · 3 yrs 4 mos" },
        metadata: { text: "Bengaluru, India" },
      }),
    ]);

    expect(parseExperience(json)).toEqual([
      {
        title: "Senior Engineer",
        company: "Acme Corp · Full-time",
        duration: "Jan 2020 - Present · 3 yrs 4 mos",
        location: "Bengaluru, India",
        description: null,
      },
    ]);
  });

  it("parses a multi-position (grouped promotions) entry, using the outer company and first position", () => {
    const json = pagedSection([
      entityElement({
        titleV2: { text: { text: "Acme Corp" } },
        subComponents: {
          components: [
            {
              components: {
                pagedListComponent: {
                  components: {
                    elements: [
                      entityElement({
                        titleV2: { text: { text: "Staff Engineer" } },
                        subtitle: { text: "Full-time" },
                        caption: { text: "Jan 2023 - Present · 1 yr 8 mos" },
                        metadata: { text: "Remote" },
                      }),
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    ]);

    expect(parseExperience(json)).toEqual([
      {
        title: "Staff Engineer",
        company: "Acme Corp",
        duration: "Jan 2023 - Present · 1 yr 8 mos",
        location: "Remote",
        description: null,
      },
    ]);
  });

  it("throws on an unexpected shape (no pagedListComponent)", () => {
    expect(() => parseExperience({ data: {} })).toThrow(/Unexpected section response shape/);
  });
});

describe("parseEducation", () => {
  it("parses school/degree/duration, leaving degree unsplit", () => {
    const json = pagedSection([
      entityElement({
        titleV2: { text: { text: "Example University" } },
        subtitle: { text: "Bachelor's degree, Computer Science" },
        caption: { text: "2016 - 2020" },
      }),
    ]);

    expect(parseEducation(json)).toEqual([
      { school: "Example University", degree: "Bachelor's degree, Computer Science", duration: "2016 - 2020" },
    ]);
  });
});

describe("parseSkills", () => {
  it("extracts and dedupes skill names across tabbed sections", () => {
    const json = {
      data: {
        identityDashProfileComponentsBySectionType: {
          elements: [
            {
              components: {
                tabComponent: {
                  sections: [
                    {
                      subComponent: {
                        components: {
                          pagedListComponent: {
                            components: {
                              elements: [
                                entityElement({ titleV2: { text: { text: "TypeScript" } } }),
                                entityElement({ titleV2: { text: { text: "Node.js" } } }),
                              ],
                            },
                          },
                        },
                      },
                    },
                    {
                      subComponent: {
                        components: {
                          pagedListComponent: {
                            components: {
                              elements: [entityElement({ titleV2: { text: { text: "TypeScript" } } })],
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    expect(parseSkills(json)).toEqual(["TypeScript", "Node.js"]);
  });

  it("throws on an unexpected shape (no tabComponent)", () => {
    expect(() => parseSkills({ data: {} })).toThrow(/Unexpected skills response shape/);
  });
});

describe("parseCertifications", () => {
  it("strips the 'Issued ' prefix and keeps date as a raw string", () => {
    const json = pagedSection([
      entityElement({
        titleV2: { text: { text: "AWS Certified Solutions Architect" } },
        subtitle: { text: "Amazon Web Services (AWS)" },
        caption: { text: "Issued Jun 2021" },
      }),
    ]);

    expect(parseCertifications(json)).toEqual([
      { name: "AWS Certified Solutions Architect", issuer: "Amazon Web Services (AWS)", date: "Jun 2021" },
    ]);
  });
});

describe("parseLanguages", () => {
  it("returns a flat list of names", () => {
    const json = pagedSection([
      entityElement({ titleV2: { text: { text: "English" } } }),
      entityElement({ titleV2: { text: { text: "Hindi" } } }),
    ]);

    expect(parseLanguages(json)).toEqual(["English", "Hindi"]);
  });
});

describe("parseBio", () => {
  it("reads elements[3].topComponents[1]'s text", () => {
    const json = {
      data: {
        identityDashProfileCardsByInitialCards: {
          elements: [
            {},
            {},
            {},
            { topComponents: [{}, { components: { textComponent: { text: { text: "Building things." } } } }] },
          ],
        },
      },
    };

    expect(parseBio(json)).toBe("Building things.");
  });

  it("fails closed (returns null, never throws) on a missing/reshaped index", () => {
    expect(parseBio({ data: { identityDashProfileCardsByInitialCards: { elements: [] } } })).toBeNull();
    expect(parseBio({})).toBeNull();
    expect(parseBio(null)).toBeNull();
  });
});
