import {
  AppError,
  InvalidUrlError,
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  ExtractionTimeoutError,
  UnknownExtractionError,
} from "../errors/errorTypes.js";

// Split out from queue.ts (which opens a real Redis connection on import) so this
// pure mapping logic is unit-testable without a live Redis — same reasoning as
// extraction/implementation/redirectBlock.ts.
export function toAppError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  // Cross-boundary contract: worker.ts encodes { code, message } as JSON inside Error.message.
  // A non-JSON message here means BullMQ's own wait-timeout fired (job.waitUntilFinished's
  // ttl), not a worker-thrown AppError — see "Job wait ... timed out ..." in bullmq's Job.
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
