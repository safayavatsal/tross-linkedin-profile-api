// Voyager "Dash" endpoint URL builders — sourced from that project's actual
// request-building code (see internal notes), not guessed.
//
// Only `topCardUrl` is wired into the shipped `linkedinExtractor.ts` so far. The rest
// are unverified against a live account: that project's code confirms the *endpoint shapes*
// (queryId, variables), but not the *response* field mapping (title/company/duration
// etc. inside `identityDashProfileComponentsBySectionType`) — that's genuinely unknown
// until a real response is seen. `scripts/probeLinkedinDashSections.ts` fetches and
// prints the raw JSON for exactly that reason: capture real evidence once, in the same
// live session as ticket T7, instead of shipping a blind field-mapping guess.

function encodeProfileUrn(profileUrnId: string): string {
  return encodeURIComponent(`urn:li:fsd_profile:${profileUrnId}`);
}

export function topCardUrl(memberIdentity: string): string {
  const decorationId = "com.linkedin.voyager.dash.deco.identity.profile.TopCardComplete-138";
  return `https://www.linkedin.com/voyager/api/voyagerIdentityDashProfiles?count=1&decorationId=${decorationId}&memberIdentity=${memberIdentity}&q=memberIdentity`;
}

// LinkedIn's Dash "components by section" query is parameterized by sectionType —
// experience is the one section that project documents calling it for, but the same
// queryId/shape is a reasonable, low-risk candidate for the other list-shaped sections
// the challenge asks for (education, skills, certifications, languages): inferred from
// the endpoint's own generic name, not independently confirmed per section.
export const SECTION_TYPES = ["experience", "education", "skills", "certifications", "languages"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export function profileComponentsBySectionTypeUrl(profileUrnId: string, sectionType: SectionType): string {
  const queryId = "voyagerIdentityDashProfileComponents.277ba7d7b9afffb04683953cede751fb";
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
