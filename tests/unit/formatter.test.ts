import { describe, it, expect } from "vitest";
import { formatProfile } from "../../src/formatter/profileFormatter.js";
import { mockExtractor, emptyProfileExtractorFixture } from "../../src/extraction/implementation/mockExtractor.js";
import type { RawProfileData } from "../../src/types/profile.types.js";

describe("formatProfile", () => {
  it("omits keys for sections that are undefined in the raw data", () => {
    const formatted = formatProfile(emptyProfileExtractorFixture);

    expect(formatted).not.toHaveProperty("experience");
    expect(formatted).not.toHaveProperty("education");
    expect(formatted).not.toHaveProperty("skills");
    expect(formatted).not.toHaveProperty("certifications");
    expect(formatted).not.toHaveProperty("languages");
    expect(formatted).not.toHaveProperty("images");
  });

  it("maps always-present scalar nulls to null, not omitted", () => {
    const formatted = formatProfile(emptyProfileExtractorFixture);

    expect(formatted).toHaveProperty("headline", null);
    expect(formatted).toHaveProperty("location", null);
    expect(formatted).toHaveProperty("about", null);
  });

  it("includes a present-but-empty array field as []", () => {
    const raw: RawProfileData = {
      ...emptyProfileExtractorFixture,
      skills: [],
      languages: [],
    };

    const formatted = formatProfile(raw);

    expect(formatted.skills).toEqual([]);
    expect(formatted.languages).toEqual([]);
  });

  it("maps a null image field to null rather than omitting the images object", () => {
    const raw: RawProfileData = {
      ...emptyProfileExtractorFixture,
      profilePhotoUrl: null,
      bannerUrl: null,
    };

    const formatted = formatProfile(raw);

    expect(formatted.images).toEqual({ profile_photo: null, banner: null });
  });

  it("formats a fully-populated profile with every section present", async () => {
    const raw = await mockExtractor.fetch("https://www.linkedin.com/in/jane-doe");
    const formatted = formatProfile(raw);

    expect(formatted.name).toBe(raw.name);
    expect(formatted.headline).toBe(raw.headline);
    expect(formatted.location).toBe(raw.location);
    expect(formatted.about).toBe(raw.about);
    expect(formatted.experience).toHaveLength(raw.experience!.length);
    expect(formatted.experience![0]).toEqual({
      title: raw.experience![0].title,
      company: raw.experience![0].company,
      duration: raw.experience![0].duration,
      location: raw.experience![0].location,
      description: raw.experience![0].description,
    });
    expect(formatted.education).toHaveLength(raw.education!.length);
    expect(formatted.skills).toEqual(raw.skills);
    expect(formatted.certifications).toHaveLength(raw.certifications!.length);
    expect(formatted.languages).toEqual(raw.languages);
    expect(formatted.images).toEqual({
      profile_photo: raw.profilePhotoUrl,
      banner: raw.bannerUrl ?? null,
    });
  });
});
