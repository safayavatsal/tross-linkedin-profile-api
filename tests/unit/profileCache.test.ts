import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedis = { get: vi.fn(), set: vi.fn() };
vi.mock("../../src/cache/redisClient.js", () => ({ redis: mockRedis }));

const { getCachedProfile, setCachedProfile } = await import("../../src/cache/profileCache.js");
const { config } = await import("../../src/config/index.js");

describe("profileCache", () => {
  const url = "https://www.linkedin.com/in/jane-doe";
  const profile = { name: "Jane Doe", headline: null, location: null, about: null };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the parsed profile on a cache hit", async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify(profile));

    await expect(getCachedProfile(url)).resolves.toEqual(profile);
    expect(mockRedis.get).toHaveBeenCalledWith(`profile:${url}`);
  });

  it("returns null on a cache miss", async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(getCachedProfile(url)).resolves.toBeNull();
  });

  it("fails open (returns null, does not throw) if redis.get errors", async () => {
    mockRedis.get.mockRejectedValue(new Error("connection refused"));

    await expect(getCachedProfile(url)).resolves.toBeNull();
  });

  it("writes the profile with the configured TTL", async () => {
    mockRedis.set.mockResolvedValue("OK");

    await setCachedProfile(url, profile);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `profile:${url}`,
      JSON.stringify(profile),
      "EX",
      config.profileCacheTtlSeconds,
    );
  });

  it("fails open (does not throw) if redis.set errors", async () => {
    mockRedis.set.mockRejectedValue(new Error("connection refused"));

    await expect(setCachedProfile(url, profile)).resolves.toBeUndefined();
  });
});
