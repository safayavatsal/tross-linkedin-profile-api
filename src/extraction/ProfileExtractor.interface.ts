import type { RawProfileData } from "../types/profile.types.js";

// docs/02_LLD.md §6 — the seam between system design and the independently
// owned extraction implementation. Any implementation behind this interface
// must be swappable without touching API/cache/queue code.
export interface ProfileExtractor {
  fetch(normalizedUrl: string): Promise<RawProfileData>;
}
