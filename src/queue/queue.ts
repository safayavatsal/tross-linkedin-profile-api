import { Queue, QueueEvents } from "bullmq";
import { redis } from "../cache/redisClient.js";
import { config } from "../config/index.js";
import type { RawProfileData } from "../types/profile.types.js";
import { toAppError } from "./toAppError.js";

interface ExtractionJobData {
  normalizedUrl: string;
}

export const queue = new Queue<ExtractionJobData, RawProfileData>("profile-extraction", { connection: redis });
export const queueEvents = new QueueEvents("profile-extraction", { connection: redis });

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
