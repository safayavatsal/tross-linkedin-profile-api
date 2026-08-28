import { Queue, QueueEvents } from "bullmq";
import { redis } from "../cache/redisClient.js";
import { config } from "../config/index.js";
import type { RawProfileData } from "../types/profile.types.js";
import {
  AppError,
  InvalidUrlError,
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  ExtractionTimeoutError,
  UnknownExtractionError,
} from "../errors/errorTypes.js";

interface ExtractionJobData {
  normalizedUrl: string;
}

export const queue = new Queue<ExtractionJobData, RawProfileData>("profile-extraction", { connection: redis });
export const queueEvents = new QueueEvents("profile-extraction", { connection: redis });

function toAppError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  // Cross-boundary contract: worker.ts encodes { code, message } as JSON inside Error.message.
  let parsed: { code?: string; message?: string } | undefined;
  try {
    parsed = JSON.parse(message);
  } catch {
    return new ExtractionTimeoutError();
  }
  if (!parsed || typeof parsed.code !== "string") {
    return new UnknownExtractionError(message);
  }
  const errMessage = parsed.message ?? message;
  switch (parsed.code) {
    case "INVALID_URL":
      return new InvalidUrlError(errMessage);
    case "PROFILE_NOT_FOUND":
      return new ProfileNotFoundError(errMessage);
    case "PROFILE_PRIVATE_OR_UNREACHABLE":
      return new ProfilePrivateOrUnreachableError(errMessage);
    case "UPSTREAM_RATE_LIMITED":
      return new UpstreamRateLimitedError(errMessage);
    case "EXTRACTION_TIMEOUT":
      return new ExtractionTimeoutError(errMessage);
    default:
      return new UnknownExtractionError(errMessage);
  }
}

export async function runExtractionJob(normalizedUrl: string): Promise<RawProfileData> {
  const job = await queue.add(
    "extract",
    { normalizedUrl },
    { attempts: config.extractionMaxAttempts, backoff: { type: "exponential", delay: 1000 } }
  );
  try {
    return await job.waitUntilFinished(queueEvents, config.extractionTimeoutMs);
  } catch (err) {
    throw toAppError(err);
  }
}
