import { describe, it, expect } from "vitest";
import { normalizeLinkedInUrl } from "../../src/validation/linkedinUrl.validator.js";
import { InvalidUrlError } from "../../src/errors/errorTypes.js";

describe("normalizeLinkedInUrl", () => {
  it("normalizes a standard www URL", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe")).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
  });

  it("normalizes a bare linkedin.com URL (no www)", () => {
    expect(normalizeLinkedInUrl("https://linkedin.com/in/jane-doe")).toBe(
      "https://linkedin.com/in/jane-doe",
    );
  });

  it("normalizes a country-subdomain URL", () => {
    expect(normalizeLinkedInUrl("https://in.linkedin.com/in/jane-doe")).toBe(
      "https://in.linkedin.com/in/jane-doe",
    );
  });

  it("normalizes a trailing slash away", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe/")).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
  });

  it("lowercases an uppercase host", () => {
    expect(normalizeLinkedInUrl("https://WWW.LINKEDIN.COM/in/jane-doe")).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
  });

  it("strips tracking query params", () => {
    expect(
      normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe?utm_source=share&trk=public"),
    ).toBe("https://www.linkedin.com/in/jane-doe");
  });

  it("throws InvalidUrlError for missing input", () => {
    expect(() => normalizeLinkedInUrl(undefined)).toThrow(InvalidUrlError);
  });

  it("throws InvalidUrlError for non-string input", () => {
    expect(() => normalizeLinkedInUrl(12345)).toThrow(InvalidUrlError);
  });

  it("throws InvalidUrlError for a non-URL string", () => {
    expect(() => normalizeLinkedInUrl("not-a-url")).toThrow(InvalidUrlError);
  });

  it("throws InvalidUrlError for a non-LinkedIn domain", () => {
    expect(() => normalizeLinkedInUrl("https://www.example.com/in/jane-doe")).toThrow(InvalidUrlError);
  });

  it("throws InvalidUrlError for a LinkedIn company path", () => {
    expect(() => normalizeLinkedInUrl("https://www.linkedin.com/company/acme")).toThrow(InvalidUrlError);
  });

  it("throws InvalidUrlError for a LinkedIn pub path", () => {
    expect(() => normalizeLinkedInUrl("https://www.linkedin.com/pub/jane-doe/1/2/3")).toThrow(
      InvalidUrlError,
    );
  });

  it("throws InvalidUrlError for a bare linkedin.com root path", () => {
    expect(() => normalizeLinkedInUrl("https://www.linkedin.com/")).toThrow(InvalidUrlError);
  });
});
