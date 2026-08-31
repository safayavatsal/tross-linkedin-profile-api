import { describe, it, expect } from "vitest";
import { topCardUrl } from "../../src/extraction/implementation/linkedinDashEndpoints.js";

describe("linkedinDashEndpoints", () => {
  it("builds the top-card finder URL with the memberIdentity and decorationId", () => {
    const url = topCardUrl("jane-doe");
    expect(url).toContain("voyagerIdentityDashProfiles");
    expect(url).toContain("memberIdentity=jane-doe");
    expect(url).toContain("decorationId=com.linkedin.voyager.dash.deco.identity.profile.TopCardComplete-138");
  });
});
