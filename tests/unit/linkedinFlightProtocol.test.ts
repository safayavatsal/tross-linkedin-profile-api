import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseFlightResponse,
  extractCardEntries,
  extractAboutText,
  extractSkills,
  fetchDetailsPage,
} from "../../src/extraction/implementation/linkedinFlightProtocol.js";

// Wire-format fixtures shaped exactly like real captured responses (T12): module-reference
// lines declare an alias->hash mapping, data lines are `<hex-id>:<json>`. Real content lives
// in a handful of recurring component shapes — see linkedinFlightProtocol.ts's module docstring.
const TEXT_HASH = "85b20fca39223dffe536dd03122e5f56";
const EXPANDABLE_HASH = "1e9b95c01e7f142c1ba9a289f4714a9c";

function flight(lines: string[]) {
  return parseFlightResponse(lines.join("\n"));
}

describe("parseFlightResponse", () => {
  it("separates module-reference lines (alias->hash) from data-bearing chunks", () => {
    const parsed = flight([`a:I["${TEXT_HASH}",[],"default"]`, `1:["$","p",null,{"children":["hi"]}]`]);
    expect(parsed.aliasToHash.get("a")).toBe(TEXT_HASH);
    expect(parsed.chunks.get(1)).toEqual(["$", "p", null, { children: ["hi"] }]);
  });

  it("resolves the same module hash regardless of which alias number a response assigned it", () => {
    // The exact scenario the real parser guards against: two different responses aliasing the
    // identical component under different numbers.
    const responseA = flight([`20:I["${TEXT_HASH}",[],"default"]`, `1:["$","$L20",null,{"textProps":{"children":["a"],"fontWeight":"bold"}}]`]);
    const responseB = flight([`d:I["${TEXT_HASH}",[],"default"]`, `1:["$","$Ld",null,{"textProps":{"children":["a"],"fontWeight":"bold"}}]`]);
    expect(extractSkills(responseA)).toEqual(["a"]);
    expect(extractSkills(responseB)).toEqual(["a"]);
  });
});

describe("extractCardEntries", () => {
  it("groups a title/subtitle pair with two following smalltext chunks into one entry", () => {
    const parsed = flight([
      `a:I["${TEXT_HASH}",[],"default"]`,
      `1:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["Acme Corp · Full-time"]}]`,
      `3:["$","$La",null,{"textProps":{"children":["Jan 2020 - Present · 3 yrs 4 mos"]}}]`,
      `4:["$","$La",null,{"textProps":{"children":["Bengaluru, India"]}}]`,
    ]);

    expect(extractCardEntries(parsed)).toEqual([
      { title: "Senior Engineer", subtitle: "Acme Corp · Full-time", dates: "Jan 2020 - Present · 3 yrs 4 mos", location: "Bengaluru, India", description: null },
    ]);
  });

  it("maps positional descriptions onto entries in order", () => {
    const parsed = flight([
      `b:I["${EXPANDABLE_HASH}",[],"default"]`,
      `1:["$","$Lb",null,{"textProps":{"children":["Built the thing."]}}]`,
      `2:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`,
    ]);

    expect(extractCardEntries(parsed)).toEqual([
      { title: "Senior Engineer", subtitle: null, dates: null, location: null, description: "Built the thing." },
    ]);
  });

  it("returns a title-only entry with nulls when no subtitle/dates/location follow", () => {
    const parsed = flight([`1:["$","p",null,{"className":"c2d1c236","children":["Hindi"]}]`]);
    expect(extractCardEntries(parsed)).toEqual([{ title: "Hindi", subtitle: null, dates: null, location: null, description: null }]);
  });

  // Real shape (T14): the details page (see fetchDetailsPage) renders full page chrome
  // alongside the requested section, including a right-rail "who viewed your profile"
  // upsell that matches the same title/subtitle card shape as real data.
  it("drops the 'who viewed your profile' upsell card, keeping real entries", () => {
    const parsed = flight([
      `1:["$","p",null,{"className":"c2d1c236","children":["Unlock the full list"]}]`,
      `2:["$","p",null,{"className":"_61558a10","children":["See who viewed your profile"]}]`,
      `3:["$","p",null,{"className":"c2d1c236","children":["Senior Engineer"]}]`,
    ]);
    expect(extractCardEntries(parsed)).toEqual([
      { title: "Senior Engineer", subtitle: null, dates: null, location: null, description: null },
    ]);
  });
});

describe("fetchDetailsPage", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("extracts and reassembles the window.__como_rehydration__ stream from the details page HTML", async () => {
    const line1 = `1:I["${TEXT_HASH}",[],"default"]\n`;
    const line2 = `2:["$","p",null,{"className":"c2d1c236","children":["Example"]}]`;
    const html = `<html><body><script>window.__como_rehydration__ = ${JSON.stringify([line1, line2])};</script></body></html>`;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html }) as unknown as typeof fetch;

    const stream = await fetchDetailsPage("someone", "experience");
    expect(extractCardEntries(parseFlightResponse(stream))).toEqual([
      { title: "Example", subtitle: null, dates: null, location: null, description: null },
    ]);
  });
});

describe("extractAboutText", () => {
  it("returns the expandable text block's content", () => {
    const parsed = flight([`b:I["${EXPANDABLE_HASH}",[],"default"]`, `1:["$","$Lb",null,{"textProps":{"children":["Building things that matter."]}}]`]);
    expect(extractAboutText(parsed)).toBe("Building things that matter.");
  });

  it("returns null when the profile has no About section filled in", () => {
    expect(extractAboutText(flight([]))).toBeNull();
  });

  // Real shape (T14): multi-paragraph About/description text isn't a single string child —
  // it's a nested array of one `["$", alias, key, {children}]` segment per line, each
  // optionally preceded by a `<br/>` element. The old singleTextChild-only check silently
  // dropped this as null; extractAboutText/extractCardEntries must reconstruct it instead.
  it("reconstructs multi-paragraph text from nested line-segment tuples", () => {
    const richChildren = [
      [
        ["$", "$c", "0", { children: [null, "First line."] }],
        ["$", "$c", "1", { children: [["$", "br", null, {}], "Second line."] }],
      ],
    ];
    const payload = ["$", "$Lb", null, { textProps: { children: richChildren } }];
    const parsed = flight([`b:I["${EXPANDABLE_HASH}",[],"default"]`, `1:${JSON.stringify(payload)}`]);
    expect(extractAboutText(parsed)).toBe("First line.\nSecond line.");
  });
});

describe("extractSkills", () => {
  it("keeps only the bold-weight Text component (skill name), not the normal-weight detail", () => {
    const parsed = flight([
      `a:I["${TEXT_HASH}",[],"default"]`,
      `1:["$","$La",null,{"textProps":{"children":["TypeScript"],"fontWeight":"bold"}}]`,
      `2:["$","$La",null,{"textProps":{"children":["5 endorsements"],"fontWeight":"normal"}}]`,
      `3:["$","$La",null,{"textProps":{"children":["Node.js"],"fontWeight":"bold"}}]`,
    ]);
    expect(extractSkills(parsed)).toEqual(["TypeScript", "Node.js"]);
  });
});
