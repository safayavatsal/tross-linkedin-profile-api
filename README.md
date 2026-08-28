# Tross LinkedIn Profile API

A hosted HTTP API that accepts a LinkedIn profile URL and returns structured JSON (name, headline, location, about, experience, education, skills, certifications, languages, images). Built for the Tross engineering hiring challenge.

> **Extraction is real, not mocked** — an authenticated LinkedIn Voyager extractor with a no-login public fallback, both behind a swappable `ProfileExtractor` interface. See [Extraction layer](#extraction-layer) for what each does, how to enable the authenticated path, and — importantly — a concrete account of the extraction surface being actively hostile right now (LinkedIn's REST API returning `410 Gone`, anonymous views hitting a signup wall) discovered while building this.

## Contents

- [Quick start](#quick-start)
- [API](#api)
- [Approach](#approach)
- [Extraction layer (stub)](#extraction-layer-stub)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

## Quick start

### Option A — Docker Compose (app + Redis together)

```bash
docker-compose -f docker/compose/docker-compose.yml up --build
curl http://localhost:3000/health
```

### Option B — local Node

Requires Node 20+ and a Redis instance reachable at `REDIS_URL` (defaults to `redis://localhost:6379`).

```bash
npm install
cp .env.example .env
npm run dev        # tsx watch, http://localhost:3000
```

Try it:

```bash
curl -X POST http://localhost:3000/api/v1/profile \
  -H 'Content-Type: application/json' \
  -d '{"linkedin_url":"https://www.linkedin.com/in/jane-doe-example"}'
```

The first call fetches through the (mock) extraction pipeline (`meta.source: "live"`); repeat the same URL and it's served from Redis (`meta.source: "cache"`).

There's also a minimal browser UI at [`http://localhost:3000`](http://localhost:3000) — a single form that POSTs to `/api/v1/profile` and prints the raw JSON response (`public/index.html`, served by `src/api/routes/ui.routes.ts`, no framework or build step).

## API

Full contract: [`docs/07_API_Contract.md`](docs/07_API_Contract.md).

### `POST /api/v1/profile`

```json
{ "linkedin_url": "https://www.linkedin.com/in/example-profile" }
```

**200 OK**

```json
{
  "status": "success",
  "data": {
    "name": "Jane Doe",
    "headline": "Senior Software Engineer at Example Co.",
    "location": "Bengaluru, India",
    "about": "...",
    "experience": [ { "title": "...", "company": "...", "duration": "...", "location": "...", "description": "..." } ],
    "education": [ { "school": "...", "degree": "...", "duration": "..." } ],
    "skills": ["TypeScript", "Node.js"],
    "certifications": [ { "name": "...", "issuer": "...", "date": "..." } ],
    "languages": ["English", "Hindi"],
    "images": { "profile_photo": "https://...", "banner": null }
  },
  "meta": { "source": "cache", "fetched_at": "2026-08-28T10:15:00Z" }
}
```

**Missing-field convention** (applied consistently by `src/formatter/profileFormatter.ts`): a field that exists on the profile but is empty is `null` (scalars/objects) or `[]` (arrays). A section LinkedIn doesn't expose for this profile at all is **omitted** from the object entirely.

### `GET /health`

```json
{ "status": "ok" }
```

### Errors

Every error, from every endpoint, uses one shape:

```json
{ "status": "error", "error": { "code": "PROFILE_PRIVATE_OR_UNREACHABLE", "message": "...", "http_status": 422 } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | Not a valid `linkedin.com/in/<slug>` URL |
| `PROFILE_NOT_FOUND` | 404 | Profile doesn't exist |
| `PROFILE_PRIVATE_OR_UNREACHABLE` | 422 | Profile exists but data isn't accessible |
| `UPSTREAM_RATE_LIMITED` | 429 | Extraction layer (or the API's own client rate limiter) is throttled |
| `EXTRACTION_TIMEOUT` | 504 | Extraction took too long |
| `INTERNAL_ERROR` | 500 | Unexpected failure (no stack trace returned to the client) |

## Approach

Full design docs are in [`docs/`](docs/) (`01_HLD.md` through `08_Risk_Limitations.md`) — they were written first and the implementation follows them. Summary:

- **Layered single service**, not microservices: API (Fastify) → validation → cache (Redis) → queue (BullMQ) → extraction (behind an interface) → formatter → response. Each layer is a separate module so it could be split into its own service later without a rewrite.
- **Sync-with-timeout request mode** (per `docs/02_LLD.md` §5): the client gets one HTTP response, not a poll loop. Internally, the request still goes through a real BullMQ job — `POST /api/v1/profile` enqueues a job and awaits it with a bounded timeout (`EXTRACTION_TIMEOUT_MS`), so retry/backoff and the extraction throttle are real, not simulated. Async job-status polling (`GET /api/v1/profile/status/:jobId`) is designed for in the LLD but not wired up — noted as a "designed for, not built" extension point, matching the LLD's own recommendation for a 3-day scope.
- **Isolation of the extraction layer**: `ProfileExtractor.fetch(url)` is the one seam the rest of the system depends on. Swap `mockExtractor` for a real implementation and nothing else changes.
- **Fail-open cache**: if Redis is down, `getCachedProfile`/`setCachedProfile` log a warning and behave as a miss/no-op rather than failing the request — matches the error-handling matrix in `docs/06_Project_Plan_Checkpoints.md` §3.
- **In-process worker**: for this scope, the BullMQ worker runs in the same container/process as the API (`src/queue/worker.ts` is imported as a side effect of `src/api/server.ts`) — see `docs/03_Architecture.md` §3–4 for how this would split into its own deployable process to scale extraction independently of API traffic.

Architecture and sequence diagrams: [`docs/04_Architecture_Diagram.md`](docs/04_Architecture_Diagram.md) (Mermaid, renders natively on GitHub).

### Deviations from the design docs

- Added `src/services/profileService.ts` (not in `docs/05_Folder_Structure.md`) as the orchestration layer between the controller and cache/queue/formatter — the LLD describes this orchestration (§9, "Sequence: Single Request") but doesn't name a file for it.
- The BullMQ↔Fastify error boundary: BullMQ only reliably preserves `Error.message` (not custom error classes) across the queue. The worker encodes `{ code, message }` as JSON in the thrown message; `runExtractionJob` in `src/queue/queue.ts` decodes it back into the matching `AppError` subclass. This is internal plumbing, not a contract change — same doc'd error matrix, same public shapes.
- Client-facing rate limiting (`@fastify/rate-limit`, keyed by IP) reuses the `UPSTREAM_RATE_LIMITED` error code for its 429s, for one consistent envelope, even though the LLD's error matrix defines that code for the upstream/extraction throttle specifically. A distinct `CLIENT_RATE_LIMITED` code would be more precise; not worth a schema change for this scope.

## Extraction layer

Three implementations behind the same `ProfileExtractor` interface (`src/extraction/ProfileExtractor.interface.ts`). `src/queue/worker.ts` chooses between the two *live* ones per request, with automatic fallback — there is no mock/fake data anywhere in the live request path:

- **`linkedinExtractor.ts`** (tried first, when configured) — calls LinkedIn's internal Voyager REST API (`/voyager/api/identity/profiles/{id}/profileView`) with your session cookies. When it works: full data (experience, education, skills, certifications, languages, images).
- **`publicExtractor.ts`** (used when no credentials are set, **and** automatically as a fallback if `linkedinExtractor` fails for any reason) — no login needed. Reads the schema.org `JSON-LD` block LinkedIn embeds on public profile pages for search-engine indexing. Real data, but much less of it: name, headline, current company/location, about, photo — experience/education/skills/certifications/languages aren't exposed to anonymous visitors, so those keys are omitted (same null-vs-omission convention as everywhere else).
- **`mockExtractor.ts`** — not used at runtime. Kept only as a fixture for the unit/integration test suite (`tests/unit/formatter.test.ts`, etc.), so tests don't depend on network access or real credentials.

### Real (authenticated) extraction setup

1. Log into linkedin.com in your browser.
2. Open devtools → Application/Storage → Cookies → `https://www.linkedin.com`.
3. Copy the values of the `li_at` and `JSESSIONID` cookies (the latter includes surrounding quotes in the browser — set the env var **without** the quotes).
4. Set `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` in `.env` (or Render's environment variables). `docker-compose up` reads the same repo-root `.env` automatically — just restart the stack after editing it.
5. Leave both unset (or if the authenticated call fails) and the app still returns real, if partial, data via `publicExtractor` — no setup required, and no hard failure either way.

Both are unofficial and reverse-engineered — see [Known Limitations](#known-limitations). **Concretely, during this build:** LinkedIn's classic Voyager `profileView` REST endpoint returned `410 Gone` against a live authenticated session, and investigation (via a captured HAR of an actual profile-page load) showed LinkedIn has moved profile-card rendering to a newer, internal "SDUI" (Server-Driven UI) protocol — a POST endpoint requiring a large app-generated request body and returning a React Server Components ("Flight") stream, not JSON. Replicating that reliably would need either a headless-browser approach (rendering the real page and reading the DOM, e.g. Playwright) or a from-scratch Flight-stream parser paired with session-tied request fields — both a meaningfully larger scope than this endpoint originally appeared to be, and out of scope for this build's timeline. This is exactly the volatility this section (and `docs/08_Risk_Limitations.md`) warns about, observed directly rather than theorized. `linkedinExtractor.ts` is left in place — LinkedIn's rollout of the new architecture may not be universal, and if the Voyager endpoint works for a given account it's used automatically. Neither implementation does bot-detection evasion (no proxy rotation, no fingerprint spoofing, no CAPTCHA solving, no Flight-stream reverse-engineering) — just plain HTTP requests, authenticated or anonymous.

## Project structure

```
public/
 └── index.html       minimal demo form (no framework/build step), served at GET /
src/
 ├── api/            routes, controllers, Fastify bootstrap
 ├── validation/      LinkedIn URL shape check + normalization
 ├── cache/           Redis client + get/set with TTL, fail-open
 ├── queue/           BullMQ producer (queue.ts) + consumer (worker.ts)
 ├── extraction/       ProfileExtractor interface + the stub implementation
 ├── formatter/        raw -> public schema mapping
 ├── services/        orchestrates cache -> queue -> formatter
 ├── errors/          error classes + centralized Fastify error handler
 ├── config/          single env loader
 └── types/           shared request/response/domain types
tests/
 ├── unit/            validation, formatter, error handler
 └── integration/     full POST /api/v1/profile route, via the stub extractor
docs/                 design docs (this repo's source of truth) + DEPLOY.md
docker/compose/       docker-compose.yml (build context points back at the repo root)
```

## Configuration

All config is loaded once via `src/config/index.ts`, from environment variables — see [`.env.example`](.env.example) for the full list and defaults (port/host, Redis URL, cache TTL, extraction timeout/attempts/throttle, client rate limit). No secrets are committed; `.env` is gitignored.

## Testing

```bash
npm test
```

25 tests: URL validation (valid/invalid/normalization), formatter (null vs. omission convention), centralized error handler (each `AppError` → correct status/shape), and a full integration test that exercises `POST /api/v1/profile` end-to-end through the real stub extractor, Redis cache, and BullMQ queue/worker (requires a reachable Redis, same as running the app).

## Deployment

Target: [Render](https://render.com), via the repo's `Dockerfile`. Full steps, including every environment variable to set: [`docs/DEPLOY.md`](docs/DEPLOY.md).

```bash
npm run build   # tsc -> dist/
npm start        # node dist/api/server.js
```

## Known limitations

Full write-up: [`docs/08_Risk_Limitations.md`](docs/08_Risk_Limitations.md). Highlights:

- **LinkedIn's extraction surface is actively hostile right now, observed directly during this build** — see [Extraction layer](#extraction-layer) for the full account. Concretely: the classic Voyager `profileView` REST endpoint returns `410 Gone` (LinkedIn has moved to an internal "SDUI"/React-Server-Components protocol instead); and LinkedIn is currently serving a signup/login wall to anonymous (logged-out) profile views as well, confirmed both through the API's `publicExtractor` and by checking a real logged-out browser directly. The app handles both failures correctly (a `422 PROFILE_PRIVATE_OR_UNREACHABLE`, never fabricated data), but neither extraction path is guaranteed to return real data for a given profile at any given time — this is exactly the volatility risk called out below, not a bug in this codebase.
- **Single-region, single-instance deployment** — no horizontal scaling implemented (the architecture supports adding it later; see `docs/03_Architecture.md` §4).
- **No persistent database** — Redis is a cache with a TTL, not durable storage; a flush means re-fetching on next request.
- **No authentication/authorization** on the API itself — out of scope per the challenge, would be a next step for production.
- **Async job-status polling** (`GET /api/v1/profile/status/:jobId`) is designed for but not implemented — the current sync-with-timeout mode covers the challenge's requirements; the queue is structured so polling is a small addition later.
