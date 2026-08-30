// Field-mapping parsers for LinkedIn's Voyager Dash "ProfileComponentsBySectionType" and
// "ProfileTabInitialCards" GraphQL responses (experience/education/skills/certifications/
// languages/bio). Every JSON path and parsing quirk here is sourced from reading
// cullenwatson/StaffSpy's actual Python parsing code — see
// .wayfinder/tickets/T11-staffspy-field-mapping-findings.md — not guessed. Still unverified
// against our own account's real response shape (T7 remains blocked), so every parser here
// throws on a structurally unexpected shape rather than fabricating a value; callers treat
// that as "this section unavailable" and omit the field (see linkedinExtractor.ts).
import type { RawExperienceEntry, RawEducationEntry, RawCertificationEntry } from "../../types/profile.types.js";

type Json = Record<string, unknown>;

function asArray(v: unknown): Json[] {
  return Array.isArray(v) ? (v as Json[]) : [];
}

// titleV2 is double-nested (titleV2.text.text); subtitle/caption/metadata are single-nested
// (.text) — true across every section per T11's "Common parsing quirks" #3.
function titleV2Text(entity: Json | undefined): string | null {
  const v = (entity?.titleV2 as Json | undefined)?.text as Json | undefined;
  return typeof v?.text === "string" ? v.text : null;
}

function text1(field: unknown): string | null {
  const v = (field as Json | undefined)?.text;
  return typeof v === "string" ? v : null;
}

function entityComponentOf(element: Json): Json | undefined {
  return (element.components as Json | undefined)?.entityComponent as Json | undefined;
}

// data.identityDashProfileComponentsBySectionType.elements[0].components.pagedListComponent.components.elements
// — shared by experience/education/certifications/languages (T11: "Shared response shape").
function sectionListElements(sectionJson: unknown): Json[] {
  const root = sectionJson as Json | undefined;
  const dashSection = (root?.data as Json | undefined)?.identityDashProfileComponentsBySectionType as Json | undefined;
  const first = asArray(dashSection?.elements)[0];
  const paged = (first?.components as Json | undefined)?.pagedListComponent as Json | undefined;
  const elements = (paged?.components as Json | undefined)?.elements;
  if (elements === undefined) {
    throw new Error("Unexpected section response shape: no pagedListComponent.components.elements found");
  }
  return asArray(elements);
}

// T11 "Common parsing quirks" #1: dates are a single free-text caption like
// "Jan 2020 - Present · 3 yrs 4 mos" or "2016 - 2020", not structured integers. We only
// need the human-readable duration string for our schema (RawExperienceEntry.duration is
// a string), so unlike StaffSpy we don't need to parse it into date objects — keep the raw
// caption text as-is rather than porting StaffSpy's regex+dateutil date extraction, which
// exists there only to populate a separate start_date/end_date pair our schema doesn't have.
function captionText(entity: Json | undefined): string {
  return text1(entity?.caption) ?? "";
}

export function parseExperience(sectionJson: unknown): RawExperienceEntry[] {
  return sectionListElements(sectionJson).map((element): RawExperienceEntry => {
    const entity = entityComponentOf(element);
    const subComponents = asArray((entity?.subComponents as Json | undefined)?.components);
    // Multi-position case (promotions grouped under one company) — T11 Experience #3: detected
    // by a nested pagedListComponent under subComponents; company lives on the outer entity,
    // and we surface it as one flattened entry per company (title/duration from the first
    // nested position) rather than expanding to N entries, since RawExperienceEntry has no
    // grouping concept in its schema.
    const nestedPaged = (subComponents[0]?.components as Json | undefined)?.pagedListComponent as Json | undefined;
    if (nestedPaged) {
      const company = titleV2Text(entity) ?? "";
      const firstPosition = asArray((nestedPaged.components as Json | undefined)?.elements)[0];
      const posEntity = entityComponentOf(firstPosition ?? {});
      return {
        title: titleV2Text(posEntity) ?? "",
        company,
        duration: captionText(posEntity),
        location: text1(posEntity?.metadata),
        description: null,
      };
    }

    // Single-position case (the common one) — T11 Experience #2. subtitle is
    // "Company · Employment type"; we keep it whole since RawExperienceEntry.company is one
    // string field (StaffSpy splits it further only to populate its own separate emp_type
    // field, which our schema doesn't have).
    return {
      title: titleV2Text(entity) ?? "",
      company: text1(entity?.subtitle) ?? "",
      duration: captionText(entity),
      location: text1(entity?.metadata),
      description: null,
    };
  });
}

export function parseEducation(sectionJson: unknown): RawEducationEntry[] {
  return sectionListElements(sectionJson).map((element): RawEducationEntry => {
    const entity = entityComponentOf(element);
    return {
      school: titleV2Text(entity) ?? "",
      // T11 Education #3: combined "Degree, Field of study" string, unsplit — StaffSpy doesn't
      // split it either; splitting it would be new, unsourced logic, so we don't.
      degree: text1(entity?.subtitle),
      duration: captionText(entity) || null,
    };
  });
}

// Skills use a different container (tabComponent.sections), not pagedListComponent directly —
// T11 Skills #1, LinkedIn groups skills into tabbed sub-sections (e.g. "Top skills").
export function parseSkills(sectionJson: unknown): string[] {
  const root = sectionJson as Json | undefined;
  const dashSection = (root?.data as Json | undefined)?.identityDashProfileComponentsBySectionType as Json | undefined;
  const first = asArray(dashSection?.elements)[0];
  const tabSections = (first?.components as Json | undefined)?.tabComponent as Json | undefined;
  const sections = tabSections?.sections;
  if (sections === undefined) {
    throw new Error("Unexpected skills response shape: no tabComponent.sections found");
  }

  const names = new Set<string>();
  for (const section of asArray(sections)) {
    const subComponent = (section.subComponent as Json | undefined)?.components as Json | undefined;
    const paged = subComponent?.pagedListComponent as Json | undefined;
    const elements = asArray((paged?.components as Json | undefined)?.elements);
    for (const element of elements) {
      const entity = entityComponentOf(element);
      const name = titleV2Text(entity);
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function parseCertifications(sectionJson: unknown): RawCertificationEntry[] {
  return sectionListElements(sectionJson).map((element): RawCertificationEntry => {
    const entity = entityComponentOf(element);
    const dateIssued = text1(entity?.caption);
    return {
      name: titleV2Text(entity) ?? "",
      issuer: text1(entity?.subtitle),
      // T11 Certifications #2: "Issued " prefix stripped, stays a raw string (not date-parsed).
      date: dateIssued ? dateIssued.replace(/^Issued /, "") : null,
    };
  });
}

// T11 Languages: different queryId (see linkedinDashEndpoints.ts), name-only — StaffSpy never
// reads a proficiency field, so we don't invent one either (see T11 "What could NOT be verified").
export function parseLanguages(sectionJson: unknown): string[] {
  return sectionListElements(sectionJson)
    .map((element) => titleV2Text(entityComponentOf(element)))
    .filter((name): name is string => name !== null);
}

// T11 Bio: StaffSpy uses fixed positional indices (elements[3].topComponents[1]) with no
// defensive lookup by card type, and fails closed (returns nothing) on any shape mismatch —
// we port the same fixed-index attempt with the same fail-closed behavior, since T11 found no
// sourced discriminating key to search by instead.
export function parseBio(cardsJson: unknown): string | null {
  try {
    const root = cardsJson as Json;
    const dashCards = (root.data as Json).identityDashProfileCardsByInitialCards as Json;
    const elements = asArray(dashCards.elements);
    const topComponents = asArray(elements[3]?.topComponents);
    const textComponent = (topComponents[1]?.components as Json | undefined)?.textComponent as Json | undefined;
    const text = (textComponent?.text as Json | undefined)?.text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}
