// Voyager "Dash" endpoint URL builders — sourced from cullenwatson/StaffSpy's actual
// request-building code (see .wayfinder/tickets/T2-findings.md and, for the per-section
// response field mapping, T11-staffspy-field-mapping-findings.md), not guessed.
//
// Endpoint shapes (queryId, variables) are sourced; response field mapping is sourced
// from T11's read of StaffSpy's parsers (src/extraction/implementation/linkedinSectionParsers.ts)
// but still unverified against our own account's real response shape — T7 remains blocked.

function encodeProfileUrn(profileUrnId: string): string {
  return encodeURIComponent(`urn:li:fsd_profile:${profileUrnId}`);
}

export function topCardUrl(memberIdentity: string): string {
  const decorationId = "com.linkedin.voyager.dash.deco.identity.profile.TopCardComplete-138";
  return `https://www.linkedin.com/voyager/api/voyagerIdentityDashProfiles?count=1&decorationId=${decorationId}&memberIdentity=${memberIdentity}&q=memberIdentity`;
}

// LinkedIn's Dash "components by section" query is parameterized by sectionType. Per T11
// (StaffSpy's actual per-section fetcher files): experience/education/skills/certifications
// all share one queryId; languages uses a *different* queryId on the same queryName/shape —
// confirmed from staffspy/linkedin/languages.py, not inferred.
export const SECTION_TYPES = ["experience", "education", "skills", "certifications", "languages"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

const SHARED_SECTION_QUERY_ID = "voyagerIdentityDashProfileComponents.277ba7d7b9afffb04683953cede751fb";
const LANGUAGES_QUERY_ID = "voyagerIdentityDashProfileComponents.9117695ef207012719e3e0681c667e14";

export function profileComponentsBySectionTypeUrl(profileUrnId: string, sectionType: SectionType): string {
  const queryId = sectionType === "languages" ? LANGUAGES_QUERY_ID : SHARED_SECTION_QUERY_ID;
  const variables = `(tabIndex:0,sectionType:${sectionType},profileUrn:${encodeProfileUrn(profileUrnId)},count:50)`;
  return `https://www.linkedin.com/voyager/api/graphql?queryId=${queryId}&queryName=ProfileComponentsBySectionType&variables=${variables}`;
}

export function profileTabInitialCardsUrl(profileUrnId: string): string {
  const queryId = "voyagerIdentityDashProfileCards.9ad2590cb61a073ad514922fa752f566";
  const variables = `(count:50,profileUrn:${encodeProfileUrn(profileUrnId)})`;
  return `https://www.linkedin.com/voyager/api/graphql?queryId=${queryId}&queryName=ProfileTabInitialCards&variables=${variables}`;
}

// The section/bio calls need the profile's internal urn id, which only shows up inside
// the top-card response (exact field name unconfirmed — could be `entityUrn` or similar,
// varies by decoration). Scanning for the urn pattern itself is robust regardless of
// which field holds it.
const PROFILE_URN_RE = /urn:li:fsd_profile:([\w-]+)/;

export function findProfileUrnId(rawTopCardJson: unknown): string | null {
  const match = PROFILE_URN_RE.exec(JSON.stringify(rawTopCardJson));
  return match ? match[1] : null;
}
