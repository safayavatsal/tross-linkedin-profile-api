# Low-Level Design (LLD)
## LinkedIn Profile API — Tross Hiring Challenge

---

## 1. Module Breakdown

```
src/
 ├── api/            → routes, controllers
 ├── validation/      → input validation
 ├── cache/           → Redis client + key strategy
 ├── queue/           → BullMQ producer/consumer setup
 ├── extraction/       → ProfileExtractor interface + implementation
 ├── formatter/        → raw → public schema mapping
 ├── errors/          → error classes + centralized handler
 └── config/          → env loading, constants
```

## 2. API Layer

**Route:** `POST /api/v1/profile`

**Controller responsibilities:**
- Parse and validate request body.
- Delegate to `ProfileService.getProfile(url)`.
- Map service-level results/errors to HTTP responses.

**Route:** `GET /api/v1/profile/status/:jobId` (async path, if extraction is queued rather than synchronous)

## 3. Validation Layer

- Regex/URL-parsing check: must be `https://www.linkedin.com/in/<slug>` (or regional variants).
- Reject with `400` immediately on malformed input — no need to touch cache/queue for garbage input.
- Normalize URL (strip tracking query params, enforce lowercase host) before using as cache key.

## 4. Cache Layer (Redis)

- **Key:** `profile:{normalized_url}`
- **Value:** serialized JSON of the last successful response.
- **TTL:** configurable, suggested default 24h (profile data doesn't change minute-to-minute; this is also a passive rate-limit defense).
- **On write:** only cache successful, complete-enough responses (avoid caching partial failures as if they were good data).

## 5. Queue Layer (BullMQ)

- **Why a queue at all:** extraction may be slow/rate-limited; decoupling request-accept from extraction-execution avoids blocking client connections and allows retry/backoff without punishing the caller.
- **Job payload:** `{ normalizedUrl, requestId }`
- **Retry policy:** exponential backoff, max N attempts (configurable), dead-letter after exhaustion.
- **Two supported response modes** (pick one for MVP, document the choice):
  - **Sync-ish (simplest for take-home):** API waits on the job with a bounded timeout, returns result directly.
  - **Async (more "real" system):** API returns `202 Accepted` + `jobId` immediately; client polls `/status/:jobId`.
- **Recommendation for 3-day scope:** implement sync-with-timeout as default behavior, but structure the queue so async polling is a small addition — mention this explicitly in the README as a "designed for, not fully wired" extension point if time runs out.

## 6. Extraction Layer (interface only — implementation is your independent work)

```typescript
interface ProfileExtractor {
  fetch(normalizedUrl: string): Promise<RawProfileData>;
}
```

- This interface is the seam between "system design" (my scope) and "extraction implementation" (your independent scope).
- Any implementation behind this interface should be swappable without touching API/cache/queue code — that swappability is itself a design signal worth mentioning in the README.

## 7. Formatter / Mapper Layer

- Converts `RawProfileData` → public response schema (see `07_API_Contract.md`).
- **Missing field convention:** use explicit `null` for known-but-empty fields, and omit arrays entirely only if the section doesn't exist at all (vs. `[]` if it exists but is empty). Document this convention in the README — consistency here is the signal, not the specific choice.

## 8. Error Handling Layer

Centralized error handler maps internal error types to HTTP responses:

| Internal Error | HTTP Status | Client Message |
|---|---|---|
| `InvalidUrlError` | 400 | "URL is not a valid LinkedIn profile URL" |
| `ProfileNotFoundError` | 404 | "Profile could not be located" |
| `ProfilePrivateOrUnreachableError` | 422 | "Profile data unavailable (private or restricted)" |
| `UpstreamRateLimitedError` | 429 | "Temporarily rate-limited, retry later" |
| `ExtractionTimeoutError` | 504 | "Extraction timed out" |
| `UnknownExtractionError` | 500 | "Unexpected error occurred" |

All error responses share one JSON shape (see API Contract doc) — no ad-hoc error formats per route.

## 9. Sequence: Single Request (Sync-with-timeout mode)

1. `POST /api/v1/profile` received.
2. Validate → fail fast on bad input.
3. Normalize URL → check Redis.
4. Cache hit → return `200` immediately.
5. Cache miss → enqueue BullMQ job, await with timeout.
6. Worker picks up job → calls `ProfileExtractor.fetch()`.
7. Success → Formatter maps data → cache write → return `200`.
8. Failure → map to appropriate error → return corresponding status.
9. Timeout while waiting → return `504`, job continues in background for cache warming (optional nice-to-have).

## 10. Rate Limiting

- Token-bucket or fixed-window limiter at the API layer (e.g., `@fastify/rate-limit`), keyed by IP.
- Separate internal throttle on the extraction worker itself (e.g., max N extraction calls per minute), independent of client-facing limits — this is the one that actually matters for the upstream dependency.

## 11. Configuration & Secrets

- All credentials/config via environment variables (`.env`, excluded via `.gitignore`).
- `.env.example` committed with placeholder keys only.
- Config loaded once at startup via a single `config/index.ts`, never read from `process.env` ad-hoc elsewhere.

## 12. Logging & Observability

- Structured JSON logs (e.g., via `pino`, which pairs natively with Fastify).
- Log per request: request ID, URL (hashed/truncated if needed), outcome, duration, cache hit/miss.
- Log per job: job ID, attempt number, outcome.
- No profile PII logged beyond what's necessary for debugging.
