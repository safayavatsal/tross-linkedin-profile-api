// Parses LinkedIn's current profile-section responses: a React Server Components
// ("Flight" protocol) wire format, not a plain JSON data model. LinkedIn migrated the
// entire profile page (top card excepted — that's still served by the Voyager Dash
// REST API, see linkedinDashEndpoints.ts) to this rendering system; the previous
// Voyager GraphQL "ProfileComponentsBySectionType" query this project used before is
// dead (confirmed live: HTTP 500 from LinkedIn's own backend, and no longer referenced
// by any of the client JS bundles the profile page currently loads).
//
// Format: newline-separated `<hex-id>:<payload>` lines. A payload starting with `I[`
// declares a client-module reference: `<id>:I["<hash>",[],"<Export>"]` says "id <id> is
// an alias for the module with this content hash". Later, element tuples reference
// component types as `"$L<id>"` — e.g. `["$", "$L20", null, {...}]` means "render the
// component alias 20 points to, with these props". Crucially, that alias number is
// assigned per response, not globally, so this resolves every element to its module
// hash first and matches on that instead of the alias string.
//
// Real content (job titles, company names, skill names, dates, descriptions) lives
// inside element tuples as plain rendered text, not as named data fields. This module
// recovers that content by recognizing a handful of recurring component "shapes" (a
// `<p>` with a specific className = a title or subtitle; the generic Text component in
// a bold/medium style = a skill name, the same component in a normal/small style =
// supporting detail; the generic Text component with an `expansionKey` = an expandable
// description) rather than resolving the full component tree.
//
// Verified live against a real account (T12): about/experience/education/skills use
// componentId suffix "<section>TopLevelSection"; certifications and languages use the
// *singular* form ("certificationTopLevelSection", "languageTopLevelSection") — every
// plausible plural/compound variant tried live 500'd. The className tokens below are
// CSS-in-JS generated hashes tied to LinkedIn's current frontend build and will change
// on their next rebuild, same as the old GraphQL queryId did.
import { config } from "../../config/index.js";

const COMPONENT_URL = "https://www.linkedin.com/flagship-web/rsc-action/actions/component";

export const FLIGHT_COMPONENT_IDS = {
  about: "com.linkedin.sdui.generated.profile.dsl.impl.aboutTopLevelSection",
  experience: "com.linkedin.sdui.generated.profile.dsl.impl.experienceTopLevelSection",
  education: "com.linkedin.sdui.generated.profile.dsl.impl.educationTopLevelSection",
  skills: "com.linkedin.sdui.generated.profile.dsl.impl.skillsTopLevelSection",
  certifications: "com.linkedin.sdui.generated.profile.dsl.impl.certificationTopLevelSection",
  languages: "com.linkedin.sdui.generated.profile.dsl.impl.languageTopLevelSection",
} as const;
export type FlightSection = keyof typeof FLIGHT_COMPONENT_IDS;

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

function authCookieHeaders(): Record<string, string> {
  return {
    cookie: `li_at=${config.linkedinLiAt}; JSESSIONID="${config.linkedinJsessionid}"`,
    "csrf-token": config.linkedinJsessionid as string,
    ...BROWSER_HEADERS,
  };
}

// The rsc-action component call above returns a *preview* of a section — every
// section response carries `paginationNeeded:true` and a "See all" link to
// `/in/{id}/details/{section}/` — confirmed live (T13) to actually drop entries past
// the first page for a profile with enough experience history (19 real positions;
// the preview capped at 9). Education/skills/certifications/languages were checked
// against the same account and came back complete from the preview alone (their
// lists are short enough not to hit the cap), so only experience pays for the extra
// fetch below. If a future profile hits the same cap on one of those sections, this
// is the pattern to extend.
//
// The details page is a full HTML page, but the real data isn't in the markup — it's
// the same Flight wire format embedded as `window.__como_rehydration__ = [...]`, a JS
// array of string chunks that concatenate back into one stream, parseable by the exact
// same parseFlightResponse used for the rsc-action response. It also renders the full
// page chrome (global nav, "who viewed your profile" rail, etc.), which can shows up
// as extra title/subtitle-shaped noise and unrelated description text interleaved with
// the real list — extractCardEntries filters the one recurring noise card it's known
// to produce, but its description positions are NOT trustworthy this way (see
// parseExperience in linkedinSectionParsers.ts, which sources descriptions from the
// clean preview response instead and only uses this page for entry completeness).
function extractRehydrationStream(html: string): string | null {
  const marker = "window.__como_rehydration__ = ";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const arrStart = html.indexOf("[", markerIdx);
  if (arrStart === -1) return null;

  let depth = 0;
  let inString = false;
  let i = arrStart;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  try {
    const parts = JSON.parse(html.slice(arrStart, i)) as string[];
    return parts.join("");
  } catch {
    return null;
  }
}

export async function fetchDetailsPage(publicId: string, section: FlightSection): Promise<string> {
  const res = await fetch(`https://www.linkedin.com/in/${publicId}/details/${section}/`, {
    headers: authCookieHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const stream = extractRehydrationStream(html);
  if (!stream) throw new Error("LinkedIn details page did not contain the expected rehydration payload");
  return stream;
}

export async function fetchFlightComponent(publicId: string, section: FlightSection): Promise<string> {
  const componentId = FLIGHT_COMPONENT_IDS[section];
  const url = new URL(COMPONENT_URL);
  url.searchParams.set("componentId", componentId);
  url.searchParams.set("sduiid", componentId);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { ...authCookieHeaders(), "content-type": "application/json" },
    body: JSON.stringify({
      clientArguments: {
        payload: { isSelfView: false, vanityName: publicId },
        states: [],
        requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
        screenId: "com.linkedin.sdui.flagshipnav.home.Home",
        knownTemplateIds: [],
      },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const LINE_RE = /^([0-9a-fA-F]+):(.*)$/;
const MODULE_REF_RE = /^I\["([0-9a-fA-F]+)"/;

const TITLE_CLASS_MARKER = "c2d1c236";
const SUBTITLE_CLASS_MARKER = "_61558a10";
const TEXT_COMPONENT_HASH = "85b20fca39223dffe536dd03122e5f56";
const EXPANDABLE_TEXT_HASH = "1e9b95c01e7f142c1ba9a289f4714a9c";

export interface FlightParsed {
  chunks: Map<number, unknown>;
  aliasToHash: Map<string, string>;
}

export function parseFlightResponse(text: string): FlightParsed {
  const chunks = new Map<number, unknown>();
  const aliasToHash = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, chunkId, payload] = match;
    const moduleMatch = MODULE_REF_RE.exec(payload);
    if (moduleMatch) {
      aliasToHash.set(chunkId, moduleMatch[1]);
      continue;
    }
    if (payload.startsWith('"$S')) continue;
    try {
      chunks.set(parseInt(chunkId, 16), JSON.parse(payload));
    } catch {
      // Not a data-bearing line (e.g. a bare string ref) — skip.
    }
  }
  return { chunks, aliasToHash };
}

function resolveElementType(elementType: unknown, aliasToHash: Map<string, string>): unknown {
  if (typeof elementType === "string" && elementType.startsWith("$L")) {
    return aliasToHash.get(elementType.slice(2)) ?? elementType;
  }
  return elementType;
}

function singleTextChild(children: unknown): string | null {
  return Array.isArray(children) && children.length === 1 && typeof children[0] === "string" ? children[0] : null;
}

// A description's `children` isn't always a single string: multi-paragraph text (About,
// job/education descriptions) renders as nested `["$", alias, key, {children}]` segment
// tuples — one per line, each optionally preceded by a `<br/>` element — instead of one
// flat string. Recursively join every leaf string, one per line.
function flattenRichText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!Array.isArray(node)) return "";
  if (node.length === 4 && node[0] === "$") {
    const props = node[3];
    if (props && typeof props === "object" && "children" in (props as Record<string, unknown>)) {
      return flattenRichText((props as Record<string, unknown>).children);
    }
    return "";
  }
  return node
    .map(flattenRichText)
    .filter(Boolean)
    .join("\n");
}

function textOf(children: unknown): string | null {
  const simple = singleTextChild(children);
  if (simple !== null) return simple;
  if (Array.isArray(children) && children.length === 1 && Array.isArray(children[0])) {
    const text = flattenRichText(children[0]);
    return text || null;
  }
  return null;
}

type Classified = { kind: "title" | "subtitle" | "smalltext" | "description"; text: string };

function classify(value: unknown, aliasToHash: Map<string, string>): Classified | null {
  if (!Array.isArray(value) || value.length !== 4 || value[0] !== "$") return null;
  const [, elementType, , props] = value as [string, unknown, unknown, unknown];
  if (typeof props !== "object" || props === null) return null;
  const p = props as Record<string, unknown>;
  const resolved = resolveElementType(elementType, aliasToHash);

  if (elementType === "p") {
    const text = singleTextChild(p.children);
    if (text === null) return null;
    const className = typeof p.className === "string" ? p.className : "";
    if (className.includes(TITLE_CLASS_MARKER)) return { kind: "title", text };
    if (className.includes(SUBTITLE_CLASS_MARKER)) return { kind: "subtitle", text };
    return null;
  }

  if (resolved === TEXT_COMPONENT_HASH) {
    const textProps = (p.textProps as Record<string, unknown> | undefined) ?? {};
    const text = textOf(textProps.children);
    if (text === null) return null;
    return { kind: "expansionKey" in p ? "description" : "smalltext", text };
  }

  if (resolved === EXPANDABLE_TEXT_HASH) {
    const textProps = (p.textProps as Record<string, unknown> | undefined) ?? {};
    const text = textOf(textProps.children);
    return text !== null ? { kind: "description", text } : null;
  }

  return null;
}

export interface FlightCardEntry {
  title: string;
  subtitle: string | null;
  dates: string | null;
  location: string | null;
  description: string | null;
}

// Titles/subtitles come in matched pairs, each immediately followed by zero to two
// "smalltext" chunks (dates, then location) in the same id run. Descriptions are a
// known weak spot: LinkedIn assigns them lower chunk ids than the entry they belong
// to, in the same relative order as the entries, with no id tying the two together —
// this maps them onto entries positionally (1st description to 1st entry, ...), which
// is correct as long as every entry up to the last one with a description also has
// one. A deliberate, documented tradeoff (ported as-is from the reference implementation).
export function extractCardEntries(parsed: FlightParsed): FlightCardEntry[] {
  const classified = [...parsed.chunks.entries()]
    .map(([id, value]) => {
      const result = classify(value, parsed.aliasToHash);
      return result ? ([id, result.kind, result.text] as const) : null;
    })
    .filter((x): x is readonly [number, Classified["kind"], string] => x !== null)
    .sort((a, b) => a[0] - b[0]);

  const entries: FlightCardEntry[] = [];
  const descriptions: string[] = [];
  let i = 0;
  while (i < classified.length) {
    const [, kind, text] = classified[i];
    if (kind === "title") {
      const entry: FlightCardEntry = { title: text, subtitle: null, dates: null, location: null, description: null };
      i++;
      if (i < classified.length && classified[i][1] === "subtitle") {
        entry.subtitle = classified[i][2];
        i++;
      }
      if (i < classified.length && classified[i][1] === "smalltext") {
        entry.dates = classified[i][2];
        i++;
      }
      if (i < classified.length && classified[i][1] === "smalltext") {
        entry.location = classified[i][2];
        i++;
      }
      entries.push(entry);
    } else if (kind === "description") {
      descriptions.push(text);
      i++;
    } else {
      i++;
    }
  }

  entries.forEach((entry, idx) => {
    if (descriptions[idx] !== undefined) entry.description = descriptions[idx];
  });

  // Details pages (see fetchDetailsPage) render the full page chrome, including the
  // right-rail "who viewed your profile" upsell — a title/subtitle card shape
  // indistinguishable from real data except for this fixed, non-data subtitle text.
  return entries.filter((entry) => entry.subtitle !== "See who viewed your profile");
}

export function extractAboutText(parsed: FlightParsed): string | null {
  for (const id of [...parsed.chunks.keys()].sort((a, b) => a - b)) {
    const result = classify(parsed.chunks.get(id), parsed.aliasToHash);
    if (result?.kind === "description") return result.text;
  }
  return null;
}

// Skills has a different layout than Experience/Education: no title/subtitle <p> pair,
// just the generic Text component reused at two font weights — bold+medium for the
// skill name itself, normal+small for supporting detail (endorsement counts, where
// present). fontWeight is what distinguishes a skill name here.
export function extractSkills(parsed: FlightParsed): string[] {
  const skills: string[] = [];
  for (const value of parsed.chunks.values()) {
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== "$") continue;
    const [, elementType, , props] = value as [string, unknown, unknown, unknown];
    if (typeof props !== "object" || props === null) continue;
    const p = props as Record<string, unknown>;
    if (resolveElementType(elementType, parsed.aliasToHash) !== TEXT_COMPONENT_HASH) continue;
    const textProps = (p.textProps as Record<string, unknown> | undefined) ?? {};
    if (textProps.fontWeight !== "bold") continue;
    const text = singleTextChild(textProps.children);
    if (text) skills.push(text);
  }
  return skills;
}
