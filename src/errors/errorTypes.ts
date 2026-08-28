// Error matrix — docs/02_LLD.md §8, docs/07_API_Contract.md §4.

export type ErrorCode =
  | "INVALID_URL"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_PRIVATE_OR_UNREACHABLE"
  | "UPSTREAM_RATE_LIMITED"
  | "EXTRACTION_TIMEOUT"
  | "INTERNAL_ERROR";

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidUrlError extends AppError {
  readonly code = "INVALID_URL";
  readonly httpStatus = 400;
  constructor(message = "URL is not a valid LinkedIn profile URL") {
    super(message);
  }
}

export class ProfileNotFoundError extends AppError {
  readonly code = "PROFILE_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(message = "Profile could not be located") {
    super(message);
  }
}

export class ProfilePrivateOrUnreachableError extends AppError {
  readonly code = "PROFILE_PRIVATE_OR_UNREACHABLE";
  readonly httpStatus = 422;
  constructor(message = "Profile data unavailable (private or restricted)") {
    super(message);
  }
}

export class UpstreamRateLimitedError extends AppError {
  readonly code = "UPSTREAM_RATE_LIMITED";
  readonly httpStatus = 429;
  constructor(message = "Temporarily rate-limited, retry later") {
    super(message);
  }
}

export class ExtractionTimeoutError extends AppError {
  readonly code = "EXTRACTION_TIMEOUT";
  readonly httpStatus = 504;
  constructor(message = "Extraction timed out") {
    super(message);
  }
}

export class UnknownExtractionError extends AppError {
  readonly code = "INTERNAL_ERROR";
  readonly httpStatus = 500;
  constructor(message = "Unexpected error occurred") {
    super(message);
  }
}
