import { describe, it, expect } from "vitest";
import { isNonRetryable } from "../../src/queue/isNonRetryable.js";
import {
  InvalidUrlError,
  ProfileNotFoundError,
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  ExtractionTimeoutError,
  UnknownExtractionError,
} from "../../src/errors/errorTypes.js";

describe("isNonRetryable", () => {
  it.each([
    ["InvalidUrlError", new InvalidUrlError()],
    ["ProfileNotFoundError", new ProfileNotFoundError()],
    ["ProfilePrivateOrUnreachableError", new ProfilePrivateOrUnreachableError()],
    ["UpstreamRateLimitedError", new UpstreamRateLimitedError()],
  ])("%s must not be retried", (_name, err) => {
    expect(isNonRetryable(err)).toBe(true);
  });

  it.each([
    ["ExtractionTimeoutError", new ExtractionTimeoutError()],
    ["UnknownExtractionError", new UnknownExtractionError()],
  ])("%s may still be retried", (_name, err) => {
    expect(isNonRetryable(err)).toBe(false);
  });
});
