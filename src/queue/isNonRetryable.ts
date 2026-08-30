import {
  AppError,
  InvalidUrlError,
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
} from "../errors/errorTypes.js";

export function isNonRetryable(err: AppError): boolean {
  return (
    err instanceof InvalidUrlError ||
    err instanceof ProfileNotFoundError ||
    err instanceof ProfilePrivateOrUnreachableError ||
    // Retrying a rate-limit/block signal within the same request defeats the
    // entire point of the self-imposed pacing gate (linkedinPacing.ts) — it
    // was silently causing up to 3 retry attempts x 2 extractors = up to 6
    // real outbound LinkedIn calls per single API request.
    err instanceof UpstreamRateLimitedError
  );
}
