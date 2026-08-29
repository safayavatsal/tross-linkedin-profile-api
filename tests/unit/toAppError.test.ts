import { describe, it, expect } from "vitest";
import { toAppError } from "../../src/queue/toAppError.js";
import {
  InvalidUrlError,
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  ExtractionTimeoutError,
  UnknownExtractionError,
} from "../../src/errors/errorTypes.js";

function jobError(code: string, message = "boom"): Error {
  return new Error(JSON.stringify({ code, message }));
}

describe("toAppError", () => {
  it.each([
    ["INVALID_URL", InvalidUrlError],
    ["PROFILE_NOT_FOUND", ProfileNotFoundError],
    ["PROFILE_PRIVATE_OR_UNREACHABLE", ProfilePrivateOrUnreachableError],
    ["UPSTREAM_RATE_LIMITED", UpstreamRateLimitedError],
    ["EXTRACTION_TIMEOUT", ExtractionTimeoutError],
  ] as const)("maps worker-encoded %s to %s, preserving the message", (code, ErrorClass) => {
    const result = toAppError(jobError(code, "detail from worker"));
    expect(result).toBeInstanceOf(ErrorClass);
    expect(result.message).toBe("detail from worker");
  });

  it("maps an unrecognized code to UnknownExtractionError", () => {
    expect(toAppError(jobError("SOMETHING_NEW"))).toBeInstanceOf(UnknownExtractionError);
  });

  it("maps BullMQ's own wait-timeout message (not JSON) to ExtractionTimeoutError", () => {
    const bullmqTimeout = new Error(
      "Job wait extract timed out before finishing, no finish notification arrived after 15000ms (id=42)",
    );
    expect(toAppError(bullmqTimeout)).toBeInstanceOf(ExtractionTimeoutError);
  });

  it("maps a non-Error thrown value safely to ExtractionTimeoutError", () => {
    expect(toAppError("plain string failure")).toBeInstanceOf(ExtractionTimeoutError);
  });

  it("maps valid JSON without a code field to UnknownExtractionError", () => {
    expect(toAppError(new Error(JSON.stringify({ message: "no code here" })))).toBeInstanceOf(UnknownExtractionError);
  });
});
