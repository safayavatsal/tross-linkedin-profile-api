import { describe, it, expect } from "vitest";
import { parseFlightResponse } from "../../src/extraction/implementation/linkedinFlightProtocol.js";
import {
  parseAbout,
  parseExperience,
  parseEducation,
  parseSkills,
  parseCertifications,
  parseLanguages,
} from "../../src/extraction/implementation/linkedinSectionParsers.js";

// Fixtures are real Flight-protocol wire lines (see linkedinFlightProtocol.test.ts), shaped
// per what was actually captured live against a real account (T12) — not guessed.
const TEXT_HASH = "85b20fca39223dffe536dd03122e5f56";
const EXPANDABLE_HASH = "1e9b95c01e7f142c1ba9a289f4714a9c";

function flight(lines: string[]) {
  return parseFlightResponse(lines.join("\n"));
}

describe("parseAbout", () => {
  it("returns the About card's text", () => {
    const parsed = flight([`b:I["${EXPANDABLE_HASH}",[],"default"]`, `1:["$","$Lb",null,{"textProps":{"children":["Building things that matter."]}}]`]);
    expect(parseAbout(parsed)).toBe("Building things that matter.");
  });
});

describe("parseExperience", () => {
  it("splits 'Company · Employment type' subtitles, keeping just the company", () => {
    const parsed = flight([
      `a:I["${TEXT_HASH}",[],"default"]`,
      `1:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Acme Corp · Full-time"]}]`,
      `3:["$","$La",null,{"textProps":{"children":["Jan 2020 - Present · 3 yrs 4 mos"]}}]`,
      `4:["$","$La",null,{"textProps":{"children":["Bengaluru, India"]}}]`,
    ]);

    expect(parseExperience(parsed, parsed)).toEqual([
      { title: "Senior Engineer", company: "Acme Corp", duration: "Jan 2020 - Present · 3 yrs 4 mos", location: "Bengaluru, India", description: null },
    ]);
  });

  it("keeps the whole subtitle as company when there's no ' · ' separator", () => {
    const parsed = flight([`1:["$","p",null,{"className":"c2d1c236","children":["Founding Team"]}]`, `2:["$","p",null,{"className":"_61558a10","children":["WarpVerse X"]}]`]);
    expect(parseExperience(parsed, parsed)[0].company).toBe("WarpVerse X");
  });

  it("attributes a grouped multi-position header's title to each nested position as company, and drops the header itself", () => {
    // Real shape (T13): a company header (title = company, subtitle = "Employment type ·
    // total duration") followed by title-only position entries (no subtitle of their own).
    const parsed = flight([
      `a:I["${TEXT_HASH}",[],"default"]`,
      `1:["$","p",null,{"className":"c2d1c236","children":["Deuex Solutions Pvt. Ltd."]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Full-time · 1 yr 10 mos"]}]`,
      `3:["$","p",null,{"className":"c2d1c236","children":["FDE"]}]`,
      `4:["$","$La",null,{"textProps":{"children":["Feb 2025 - Present · 1 yr 7 mos"]}}]`,
      `5:["$","p",null,{"className":"c2d1c236","children":["DevOps Engineer"]}]`,
      `6:["$","$La",null,{"textProps":{"children":["Nov 2024 - Present · 1 yr 10 mos"]}}]`,
    ]);

    expect(parseExperience(parsed, parsed)).toEqual([
      { title: "FDE", company: "Deuex Solutions Pvt. Ltd.", duration: "Feb 2025 - Present · 1 yr 7 mos", location: null, description: null },
      { title: "DevOps Engineer", company: "Deuex Solutions Pvt. Ltd.", duration: "Nov 2024 - Present · 1 yr 10 mos", location: null, description: null },
    ]);
  });

  it("stops attributing the carried-forward company once a genuine single-position entry appears", () => {
    const parsed = flight([
      `a:I["${TEXT_HASH}",[],"default"]`,
      `1:["$","p",null,{"className":"c2d1c236","children":["Deuex Solutions Pvt. Ltd."]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Full-time · 1 yr 10 mos"]}]`,
      `3:["$","p",null,{"className":"c2d1c236","children":["FDE"]}]`,
      `4:["$","$La",null,{"textProps":{"children":["Feb 2025 - Present"]}}]`,
      `5:["$","p",null,{"className":"c2d1c236","children":["Content Creator"]}]`,
      `6:["$","p",null,{"className":"_61558a10","children":["The Startup Story · Full-time"]}]`,
    ]);

    const result = parseExperience(parsed, parsed);
    expect(result[0]).toMatchObject({ title: "FDE", company: "Deuex Solutions Pvt. Ltd." });
    expect(result[1]).toMatchObject({ title: "Content Creator", company: "The Startup Story" });
  });

  // Real shape (T14): the details page (fetchDetailsPage) has the complete entry list but
  // unreliable descriptions (page chrome breaks positional matching); the rsc-action preview
  // is capped in length but has clean descriptions. parseExperience takes entries from `full`
  // and descriptions from `descriptionsSource`, matched by (title, dates) — not by position.
  it("sources entries from the full list and descriptions from the separate preview, matched by title+dates", () => {
    const full = flight([
      `1:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Acme Corp · Full-time"]}]`,
      `3:["$","p",null,{"className":"c2d1c236","children":["Junior Engineer"]}]`,
      `4:["$","p",null,{"className":"_61558a10","children":["Acme Corp · Full-time"]}]`,
    ]);
    const descriptionsSource = flight([
      `b:I["${EXPANDABLE_HASH}",[],"default"]`,
      `1:["$","$Lb",null,{"textProps":{"children":["Led the platform team."]}}]`,
      `2:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`,
    ]);

    const result = parseExperience(full, descriptionsSource);
    expect(result).toEqual([
      { title: "Senior Engineer", company: "Acme Corp", duration: "", location: null, description: "Led the platform team." },
      { title: "Junior Engineer", company: "Acme Corp", duration: "", location: null, description: null },
    ]);
  });

  it("treats a null descriptions source as no descriptions available, without throwing", () => {
    const full = flight([`1:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`]);
    expect(parseExperience(full, null)[0].description).toBeNull();
  });
});

describe("parseEducation", () => {
  it("parses school/degree/duration, leaving degree unsplit", () => {
    const parsed = flight([
      `1:["$","p",null,{"className":"c2d1c236","children":["Example University"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Bachelor's degree, Computer Science"]}]`,
      `a:I["${TEXT_HASH}",[],"default"]`,
      `3:["$","$La",null,{"textProps":{"children":["2016 - 2020"]}}]`,
    ]);

    expect(parseEducation(parsed)).toEqual([{ school: "Example University", degree: "Bachelor's degree, Computer Science", duration: "2016 - 2020" }]);
  });
});

describe("parseSkills", () => {
  it("returns bold-weight text as skill names", () => {
    const parsed = flight([`a:I["${TEXT_HASH}",[],"default"]`, `1:["$","$La",null,{"textProps":{"children":["TypeScript"],"fontWeight":"bold"}}]`]);
    expect(parseSkills(parsed)).toEqual(["TypeScript"]);
  });
});

describe("parseCertifications", () => {
  it("strips the 'Issued ' prefix and keeps date as a raw string", () => {
    const parsed = flight([
      `1:["$","p",null,{"className":"c2d1c236","children":["AWS Certified Solutions Architect"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Amazon Web Services (AWS)"]}]`,
      `a:I["${TEXT_HASH}",[],"default"]`,
      `3:["$","$La",null,{"textProps":{"children":["Issued Jun 2021"]}}]`,
    ]);

    expect(parseCertifications(parsed)).toEqual([{ name: "AWS Certified Solutions Architect", issuer: "Amazon Web Services (AWS)", date: "Jun 2021" }]);
  });
});

describe("parseLanguages", () => {
  it("returns a flat list of names from the title/subtitle card shape", () => {
    const parsed = flight([
      `1:["$","p",null,{"className":"c2d1c236","children":["English"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Native or bilingual proficiency"]}]`,
      `3:["$","p",null,{"className":"c2d1c236","children":["Hindi"]}]`,
    ]);

    expect(parseLanguages(parsed)).toEqual(["English", "Hindi"]);
  });
});
