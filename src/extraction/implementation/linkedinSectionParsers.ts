// Maps LinkedIn's Flight-protocol section responses (see linkedinFlightProtocol.ts) onto
// our RawProfileData field shapes. Verified live against a real account (T12).
import type { RawExperienceEntry, RawEducationEntry, RawCertificationEntry } from "../../types/profile.types.js";
import type { FlightParsed } from "./linkedinFlightProtocol.js";
import { extractCardEntries, extractAboutText, extractSkills } from "./linkedinFlightProtocol.js";

// Single-position entries carry "Company · Employment type" as their subtitle; we keep
// just the company (RawExperienceEntry has no separate employment-type field).
function primarySubtitle(subtitle: string | null): string {
  if (!subtitle) return "";
  return subtitle.split(" · ")[0]?.trim() || subtitle;
}

// LinkedIn's own fixed employment-type vocabulary (the dropdown when adding a position).
// Used below to tell a genuine single-position subtitle ("Acme Corp · Full-time" — a
// company name first) apart from a *grouped multi-position header*'s subtitle ("Full-time
// · 1 yr 10 mos" — an employment type first, no company name at all).
const EMPLOYMENT_TYPES = new Set([
  "Full-time",
  "Part-time",
  "Self-employed",
  "Freelance",
  "Contract",
  "Internship",
  "Trainee",
  "Seasonal",
  "Apprenticeship",
]);

function isGroupHeaderSubtitle(subtitle: string | null): boolean {
  if (!subtitle) return false;
  return EMPLOYMENT_TYPES.has(subtitle.split(" · ")[0]?.trim() ?? "");
}

export function parseAbout(parsed: FlightParsed): string | null {
  return extractAboutText(parsed);
}

function descriptionKey(entry: { title: string; dates: string | null }): string {
  return `${entry.title}|${entry.dates ?? ""}`;
}

// LinkedIn groups promotions/multiple roles at one company under a single header in its
// UI. In the flattened Flight-protocol stream that surfaces as: a "header" entry whose
// title is the *company* name and whose subtitle is "Employment type · total duration"
// (no company in it at all), immediately followed by one title-only entry per position
// (title = job title, dates = that position's own date range, no subtitle of its own —
// the company is implied by the header above). This walks the flat entry list carrying
// the most recent header's company name forward onto each subtitle-less position that
// follows it, and drops the header itself (it isn't a real job). A genuine single-position
// entry (has its own non-employment-type subtitle) resets the carried-forward company.
//
// `full` is the details-page parse (see fetchDetailsPage) — the complete entry list, but
// its own description text can't be trusted (page chrome interleaved with the real list
// breaks the positional description-to-entry match). `descriptionsSource` is the rsc-action
// preview parse — capped in length, but clean, so its descriptions are matched back onto
// `full`'s entries by (title, dates) instead.
export function parseExperience(full: FlightParsed, descriptionsSource: FlightParsed | null): RawExperienceEntry[] {
  const descriptionByKey = new Map(
    (descriptionsSource ? extractCardEntries(descriptionsSource) : [])
      .filter((entry) => entry.description)
      .map((entry) => [descriptionKey(entry), entry.description as string]),
  );

  const results: RawExperienceEntry[] = [];
  let groupCompany: string | null = null;

  for (const entry of extractCardEntries(full)) {
    if (!entry.title) continue;

    if (isGroupHeaderSubtitle(entry.subtitle)) {
      groupCompany = entry.title;
      continue;
    }

    const company = entry.subtitle ? primarySubtitle(entry.subtitle) : (groupCompany ?? "");
    if (entry.subtitle) groupCompany = null;

    results.push({
      title: entry.title,
      company,
      duration: entry.dates ?? "",
      location: entry.location,
      description: descriptionByKey.get(descriptionKey(entry)) ?? null,
    });
  }

  return results;
}

export function parseEducation(parsed: FlightParsed): RawEducationEntry[] {
  return extractCardEntries(parsed)
    .filter((entry) => entry.title)
    .map((entry) => ({
      school: entry.title,
      // "Degree, Field of study" combined string, unsplit (same convention the old
      // Voyager-GraphQL parser used) — splitting it further would be new, unsourced logic.
      degree: entry.subtitle,
      duration: entry.dates,
    }));
}

export function parseSkills(parsed: FlightParsed): string[] {
  return extractSkills(parsed);
}

export function parseCertifications(parsed: FlightParsed): RawCertificationEntry[] {
  return extractCardEntries(parsed)
    .filter((entry) => entry.title)
    .map((entry) => ({
      name: entry.title,
      issuer: entry.subtitle,
      // "Issued " prefix stripped, stays a raw string (not date-parsed) — confirmed live shape.
      date: entry.dates ? entry.dates.replace(/^Issued /, "") : null,
    }));
}

// Languages use the same title/subtitle card shape as experience/education (title =
// language name, subtitle = proficiency level) — confirmed live; NOT the bold-text "Skills"
// shape. We only surface the name (RawProfileData.languages is string[], no proficiency field).
export function parseLanguages(parsed: FlightParsed): string[] {
  return extractCardEntries(parsed)
    .map((entry) => entry.title)
    .filter((title): title is string => Boolean(title));
}
