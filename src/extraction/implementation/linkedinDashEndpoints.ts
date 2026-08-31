// Voyager "Dash" top-card endpoint URL builder — sourced from cullenwatson/StaffSpy's actual
// request-building code (see .wayfinder/tickets/T2-findings.md), confirmed live (T12) against
// a real account. This is the only profile data LinkedIn still serves through the classic
// Voyager REST/GraphQL layer; every deeper section (about/experience/education/skills/
// certifications/languages) is served through a different rendering system entirely — see
// linkedinFlightProtocol.ts for why and how that's fetched instead.

export function topCardUrl(memberIdentity: string): string {
  const decorationId = "com.linkedin.voyager.dash.deco.identity.profile.TopCardComplete-138";
  return `https://www.linkedin.com/voyager/api/voyagerIdentityDashProfiles?count=1&decorationId=${decorationId}&memberIdentity=${memberIdentity}&q=memberIdentity`;
}
