import { Worker, Job } from "bullmq";
import { redis } from "../cache/redisClient.js";
import { config } from "../config/index.js";
import { linkedinExtractor } from "../extraction/implementation/linkedinExtractor.js";
import { publicExtractor } from "../extraction/implementation/publicExtractor.js";
import { AppError, ExtractionTimeoutError, UnknownExtractionError } from "../errors/errorTypes.js";
import { isNonRetryable } from "./isNonRetryable.js";
import type { RawProfileData } from "../types/profile.types.js";

const hasLinkedinCredentials = Boolean(config.linkedinLiAt && config.linkedinJsessionid);

// Authenticated Voyager endpoint when configured, but LinkedIn's internal API shape
// can drift or reject a given session independently of whether the credentials are
// valid (see README "Extraction layer") — fall back to the no-login public extractor
// on any failure rather than hard-failing the request. No mock in the live path.
async function extractProfile(normalizedUrl: string): Promise<RawProfileData> {
  if (hasLinkedinCredentials) {
    try {
      return await linkedinExtractor.fetch(normalizedUrl);
    } catch (authErr) {
      console.warn(`[worker] linkedinExtractor failed, falling back to publicExtractor: ${(authErr as Error)?.message}`);
      try {
        return await publicExtractor.fetch(normalizedUrl);
      } catch {
        // Both paths failed: the authenticated error is the more accurate signal
        // (e.g. an actual LinkedIn block) than the anonymous fallback's generic
        // "unreachable" — surface that one instead of masking it.
        throw authErr;
      }
    }
  }
  return publicExtractor.fetch(normalizedUrl);
}

interface ExtractionJobData {
  normalizedUrl: string;
}

async function fetchWithTimeout(normalizedUrl: string): Promise<RawProfileData> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractionTimeoutError()), config.extractionTimeoutMs);
  });
  try {
    return await Promise.race([extractProfile(normalizedUrl), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const worker = new Worker<ExtractionJobData, RawProfileData>(
  "profile-extraction",
  async (job: Job<ExtractionJobData, RawProfileData>) => {
    try {
      return await fetchWithTimeout(job.data.normalizedUrl);
    } catch (err) {
      const appError =
        err instanceof AppError ? err : new UnknownExtractionError(String((err as Error)?.message ?? err));
      if (isNonRetryable(appError)) {
        await job.discard();
      }
      // Cross-boundary contract: BullMQ only reliably preserves Error.message, so encode structured info as JSON in it.
      throw new Error(JSON.stringify({ code: appError.code, message: appError.message }));
    }
  },
  {
    connection: redis,
    limiter: { max: config.extractionMaxCallsPerMinute, duration: 60000 },
  }
);
