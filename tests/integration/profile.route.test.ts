import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/api/server.js";
import { worker } from "../../src/queue/worker.js";
import { queue, queueEvents } from "../../src/queue/queue.js";
import { redis } from "../../src/cache/redisClient.js";

describe("POST /api/v1/profile", () => {
  let app: FastifyInstance;
  const originalFetch = global.fetch;
  const testUrl = "https://www.linkedin.com/in/jane-doe-test-integration";

  beforeAll(async () => {
    // No LINKEDIN_LI_AT/JSESSIONID in the test env -> the worker uses publicExtractor,
    // which calls the real global fetch. Stub the network boundary (not the extractor
    // itself) so this test exercises the real cache/queue/worker/formatter pipeline
    // without making a live call to linkedin.com.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        `<script type="application/ld+json">${JSON.stringify({
          name: "Jane Doe Test Integration",
          jobTitle: "Senior Engineer",
          description: "About text.",
          image: "https://media.licdn.com/test-photo.jpg",
          address: { addressLocality: "Bengaluru, India" },
        })}</script>`,
    }) as unknown as typeof fetch;

    app = await buildServer();
    // Real Redis persists across test runs (TTL 24h) — clear this test's key so
    // the first request below is guaranteed a cache miss.
    await redis.del(`profile:${testUrl}`);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
    await worker.close();
    await queue.close();
    await queueEvents.close();
    await redis.quit();
  });

  it("fetches a profile live on the first call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/profile",
      payload: { linkedin_url: testUrl },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("success");
    expect(typeof body.data.name).toBe("string");
    expect(body.data.name.length).toBeGreaterThan(0);
    expect(body.meta.source).toBe("live");
    expect(new Date(body.meta.fetched_at).toString()).not.toBe("Invalid Date");
  });

  it("serves the same profile from cache on the second call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/profile",
      payload: { linkedin_url: testUrl },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.source).toBe("cache");
  });

  it("rejects a malformed linkedin_url with 400 INVALID_URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/profile",
      payload: { linkedin_url: "not-a-url" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_URL");
  });

  it("rejects a request missing linkedin_url with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/profile",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("serves the demo HTML page at GET /", async () => {
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Tross LinkedIn Profile API</title>");
  });
});
