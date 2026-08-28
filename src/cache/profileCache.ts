import { redis } from "./redisClient.js";
import { config } from "../config/index.js";
import type { PublicProfile } from "../types/profile.types.js";

function cacheKey(normalizedUrl: string): string {
  return `profile:${normalizedUrl}`;
}

export async function getCachedProfile(normalizedUrl: string): Promise<PublicProfile | null> {
  try {
    const raw = await redis.get(cacheKey(normalizedUrl));
    return raw ? (JSON.parse(raw) as PublicProfile) : null;
  } catch (err) {
    console.warn(`[cache] getCachedProfile failed, failing open: ${String(err)}`);
    return null;
  }
}

export async function setCachedProfile(normalizedUrl: string, profile: PublicProfile): Promise<void> {
  try {
    await redis.set(cacheKey(normalizedUrl), JSON.stringify(profile), "EX", config.profileCacheTtlSeconds);
  } catch (err) {
    console.warn(`[cache] setCachedProfile failed, failing open: ${String(err)}`);
  }
}
