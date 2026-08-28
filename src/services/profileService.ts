import { getCachedProfile, setCachedProfile } from "../cache/profileCache.js";
import { runExtractionJob } from "../queue/queue.js";
import { formatProfile } from "../formatter/profileFormatter.js";
import type { PublicProfile, ProfileSource } from "../types/profile.types.js";

export async function getProfile(
  normalizedUrl: string,
): Promise<{ data: PublicProfile; source: ProfileSource }> {
  const cached = await getCachedProfile(normalizedUrl);
  if (cached) {
    return { data: cached, source: "cache" };
  }

  const raw = await runExtractionJob(normalizedUrl);
  const data = formatProfile(raw);
  // docs/02_LLD.md §4: only cache complete-enough responses, not partial/empty ones.
  if (data.name) {
    await setCachedProfile(normalizedUrl, data);
  }
  return { data, source: "live" };
}
