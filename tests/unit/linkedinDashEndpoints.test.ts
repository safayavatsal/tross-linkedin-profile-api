import { describe, it, expect } from "vitest";
import {
  topCardUrl,
  profileComponentsBySectionTypeUrl,
  profileTabInitialCardsUrl,
  findProfileUrnId,
  SECTION_TYPES,
} from "../../src/extraction/implementation/linkedinDashEndpoints.js";

describe("linkedinDashEndpoints", () => {
  it("builds the top-card finder URL with the memberIdentity and decorationId", () => {
    const url = topCardUrl("jane-doe");
    expect(url).toContain("voyagerIdentityDashProfiles");
    expect(url).toContain("memberIdentity=jane-doe");
    expect(url).toContain("decorationId=com.linkedin.voyager.dash.deco.identity.profile.TopCardComplete-138");
  });

  it("builds a section-components URL with the profileUrn correctly encoded", () => {
    const url = profileComponentsBySectionTypeUrl("ACoAAB123", "experience");
    expect(url).toContain("queryId=voyagerIdentityDashProfileComponents.277ba7d7b9afffb04683953cede751fb");
    expect(url).toContain("sectionType:experience");
    expect(url).toContain(encodeURIComponent("urn:li:fsd_profile:ACoAAB123"));
  });

  it("covers every section type the challenge asks for", () => {
    expect(SECTION_TYPES).toEqual(["experience", "education", "skills", "certifications", "languages"]);
  });

  it("builds the profile-tab-initial-cards (bio) URL", () => {
    const url = profileTabInitialCardsUrl("ACoAAB123");
    expect(url).toContain("queryId=voyagerIdentityDashProfileCards.9ad2590cb61a073ad514922fa752f566");
    expect(url).toContain(encodeURIComponent("urn:li:fsd_profile:ACoAAB123"));
  });

  describe("findProfileUrnId", () => {
    it("finds the urn id nested anywhere in the raw JSON", () => {
      const raw = { elements: [{ entityUrn: "urn:li:fsd_profile:ACoAAB123", other: { nested: "urn:li:fsd_profile:ACoAAB123" } }] };
      expect(findProfileUrnId(raw)).toBe("ACoAAB123");
    });

    it("returns null when no profile urn is present", () => {
      expect(findProfileUrnId({ elements: [{ firstName: "Jane" }] })).toBeNull();
    });
  });
});
