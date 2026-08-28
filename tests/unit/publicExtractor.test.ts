import { describe, it, expect, afterEach, vi } from "vitest";
import { publicExtractor } from "../../src/extraction/implementation/publicExtractor.js";
import { ProfileNotFoundError, ProfilePrivateOrUnreachableError, UpstreamRateLimitedError } from "../../src/errors/errorTypes.js";

const HTML_WITH_JSON_LD = `<html><head>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Person","name":"Jane Doe","jobTitle":"Senior Engineer","description":"About text.","image":"https://media.licdn.com/photo.jpg","address":{"addressLocality":"Bengaluru, India"}}</script>
</head><body></body></html>`;

describe("publicExtractor", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses the public JSON-LD block into RawProfileData", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => HTML_WITH_JSON_LD,
    }) as unknown as typeof fetch;

    const raw = await publicExtractor.fetch("https://www.linkedin.com/in/jane-doe");

    expect(raw.name).toBe("Jane Doe");
    expect(raw.headline).toBe("Senior Engineer");
    expect(raw.location).toBe("Bengaluru, India");
    expect(raw.about).toBe("About text.");
    expect(raw.profilePhotoUrl).toBe("https://media.licdn.com/photo.jpg");
    expect(raw.experience).toBeUndefined();
    expect(raw.education).toBeUndefined();
  });

  it("maps a 404 to ProfileNotFoundError", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(publicExtractor.fetch("https://www.linkedin.com/in/nobody")).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
  });

  it("maps a 999 (LinkedIn block response) to UpstreamRateLimitedError", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 999 }) as unknown as typeof fetch;
    await expect(publicExtractor.fetch("https://www.linkedin.com/in/blocked")).rejects.toBeInstanceOf(
      UpstreamRateLimitedError,
    );
  });

  it("maps missing JSON-LD (e.g. login-wall page) to ProfilePrivateOrUnreachableError", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html><body>Sign in to continue</body></html>",
    }) as unknown as typeof fetch;
    await expect(publicExtractor.fetch("https://www.linkedin.com/in/gated")).rejects.toBeInstanceOf(
      ProfilePrivateOrUnreachableError,
    );
  });

  it("maps a JSON-LD block with no name (generic/auth-wall boilerplate) to ProfilePrivateOrUnreachableError", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        `<script type="application/ld+json">{"@context":"http://schema.org","@type":"Person"}</script>`,
    }) as unknown as typeof fetch;
    await expect(publicExtractor.fetch("https://www.linkedin.com/in/hollow")).rejects.toBeInstanceOf(
      ProfilePrivateOrUnreachableError,
    );
  });

  it("maps a redirect-loop network failure (LinkedIn's edge block) to UpstreamRateLimitedError", async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: new Error("redirect count exceeded") }),
    ) as unknown as typeof fetch;
    await expect(publicExtractor.fetch("https://www.linkedin.com/in/blocked")).rejects.toBeInstanceOf(
      UpstreamRateLimitedError,
    );
  });
});
