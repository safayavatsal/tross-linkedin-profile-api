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

- **No browser automation in the live path, per the challenge's official clarification** (see [`docs/00_Original_Challenge.md`](docs/00_Original_Challenge.md)): "a purely reverse-engineered solution that directly hits LinkedIn endpoints and does not use a browser." Both deployed extractors (`linkedinExtractor.ts`, `publicExtractor.ts`) only make direct HTTP calls to LinkedIn's own endpoints. `playwrightExtractor.ts` exists purely as a local-only diagnostic (see [Extraction layer](#extraction-layer)) and is never wired into the deployed request path.
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

Four implementations behind the same `ProfileExtractor` interface (`src/extraction/ProfileExtractor.interface.ts`). `src/queue/worker.ts` chooses between the two *deployed* ones per request, with automatic fallback — there is no mock/fake data anywhere in the live request path:

- **`linkedinExtractor.ts`** (tried first, when configured) — calls LinkedIn's internal Voyager **"Dash"** API (`voyagerIdentityDashProfiles`, `decorationId=...TopCardComplete-138`) with your session cookies for the top-card fields (name, headline, location, photo), gated by a small self-imposed pacing module (`linkedinPacing.ts`: a minimum interval between calls plus a cooldown window after any detected block — LinkedIn's own blocking is account-level and behavior-based, not fingerprint-based, so disciplined pacing is the mitigation, not evasion tooling). If the top-card response contains the profile's internal urn, it then fetches experience, education, skills, certifications, languages, and bio (`linkedinSectionParsers.ts`) in one follow-up burst — real, sourced field mappings from reading `cullenwatson/StaffSpy`'s actual parsing code (see [T11](.wayfinder/tickets/T11-staffspy-field-mapping-findings.md)), not guessed. Each section fails independently (a parse/network failure on one section just omits that field — never fails the whole request). This replaces an earlier version that called the classic `profileView` REST endpoint, which went from `410 Gone` to a hard block during this build (see below). **Implemented and unit-tested (fixture-based, matching the sourced JSON shapes) but never run against a live LinkedIn account** — the account has been consistently blocked at LinkedIn's edge throughout this build (see below), so the section/bio calls have never actually executed against real traffic. `worker.ts` tries this path first whenever credentials are configured, falling back to `publicExtractor` on any failure — which, currently, is every request.
- **`publicExtractor.ts`** (used when no credentials are set, **and** automatically as a fallback if `linkedinExtractor` fails for any reason) — no login needed. Reads the schema.org `JSON-LD` block LinkedIn embeds on public profile pages for search-engine indexing. Real data, but much less of it: name, headline, current company/location, about, photo — experience/education/skills/certifications/languages aren't exposed to anonymous visitors, so those keys are omitted (same null-vs-omission convention as everywhere else).
- **`playwrightExtractor.ts`** (local-only, **not** deployed — see below) — renders the real profile page in headless Chromium with your session cookies and scrapes the hydrated DOM, instead of parsing LinkedIn's internal API responses. Run it with `npm run extract:local -- <profile-url>`.
- **`mockExtractor.ts`** — not used at runtime. Kept only as a fixture for the unit/integration test suite (`tests/unit/formatter.test.ts`, etc.), so tests don't depend on network access or real credentials.

### Real (authenticated) extraction setup

1. Log into linkedin.com in your browser.
2. Open devtools → Application/Storage → Cookies → `https://www.linkedin.com`.
3. Copy the values of the `li_at` and `JSESSIONID` cookies (the latter includes surrounding quotes in the browser — set the env var **without** the quotes).
4. Set `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` in `.env` (or Render's environment variables). `docker-compose up` reads the same repo-root `.env` automatically — just restart the stack after editing it.
5. Leave both unset (or if the authenticated call fails) and the app still returns real, if partial, data via `publicExtractor` — no setup required, and no hard failure either way.
6. `npm run probe:linkedin -- <profile-url>` — diagnostic-only, local, not part of the request path. Fetches the top-card call plus the experience/education/skills/certifications/languages/bio endpoints (`scripts/probeLinkedinDashSections.ts`) and prints the raw JSON — useful for validating the sourced parsers in `linkedinSectionParsers.ts` against a real response shape once the account is unblocked (see [T11](.wayfinder/tickets/T11-staffspy-field-mapping-findings.md)).

**On credential lifetime and how this is meant to be evaluated:** the challenge brief explicitly says *"you may use your own LinkedIn credentials in the backend"* — the intended model is that these credentials live only in the deployment's environment variables (Render's, in this submission), never in the evaluator's hands. Whoever tests the live public URL just POSTs a profile URL; they never need to supply `li_at`/`JSESSIONID` themselves. `li_at` is a long-lived cookie by design (LinkedIn sets it to persist roughly a year) and doesn't rotate on every login/refresh under normal circumstances — but if it does expire, get revoked, or the account gets flagged between submission and whenever this is actually evaluated, the authenticated path fails closed into `publicExtractor` (step 5 above) rather than breaking the deployed service — no credentials needed for that fallback, and no hard failure either way. Anyone who prefers to test with their *own* live session instead of relying on the deployed credentials can clone the repo and follow steps 1–4 above with their own account.

Both are unofficial and reverse-engineered — see [Known Limitations](#known-limitations). **Concretely, during this build:** LinkedIn's classic Voyager `profileView` REST endpoint initially returned `410 Gone` against a live authenticated session, and investigation (via a captured HAR of an actual profile-page load) showed LinkedIn has moved its own profile-card rendering to a newer, internal "SDUI" (Server-Driven UI) protocol — a POST endpoint requiring a large app-generated request body and returning a React Server Components ("Flight") stream, not JSON. The block later escalated: the same `profileView` endpoint moved from a clean `410` to the same infinite-redirect pattern described below — Node's `fetch()` surfaces that as `cause: Error: redirect count exceeded`, which `linkedinExtractor.ts`/`publicExtractor.ts` catch and map to `UpstreamRateLimitedError` instead of a generic 500. Separately, source-level research into other open-source LinkedIn scrapers (not LinkedIn's own web app) turned up a still-referenced Voyager **"Dash"** finder (`voyagerIdentityDashProfiles` + `decorationId=...TopCardComplete-138`) that returns plain JSON rather than a Flight stream — `linkedinExtractor.ts` now targets that instead of the dead `profileView` endpoint (see above); it's the one concrete candidate worth a live test, but hasn't been run against a real account yet, so it's held back pending that one paced, careful check rather than shipped un-verified.

**The headless-browser workaround was built and tested, and it's also blocked** — but by a different, earlier layer than the API shape. `playwrightExtractor.ts` (`src/extraction/implementation/playwrightExtractor.ts`) launches real headless Chromium, injects the `li_at`/`JSESSIONID` cookies, and navigates to the profile URL exactly like a logged-in browser would. Against the account used for this build, that request never reaches a renderable page at all: LinkedIn responds with an infinite `302` redirect to the identical URL. This reproduces identically with a plain `curl` sending the same cookies (no Playwright, no JS, no automation library involved) — so it isn't a headless-Chromium fingerprint being detected, it's LinkedIn's edge/CDN layer soft-blocking the request pattern before it ever reaches profile-serving logic. Going further from here (spoofing browser signals, rotating fingerprints, session-warming with real interactive logins) would mean building anti-detection tooling against LinkedIn's own defenses, which is out of scope for this project regardless of timeline — so this is documented as a confirmed, reproducible limitation rather than pursued further. Neither shipped extractor does bot-detection evasion (no proxy rotation, no fingerprint spoofing, no CAPTCHA solving) — just plain HTTP/browser requests, authenticated or anonymous.

**Why `playwrightExtractor.ts` isn't deployed to Render:** first and foremost, it isn't allowed to be — the challenge's official clarification email states the solution must be "a purely reverse-engineered solution that directly hits LinkedIn endpoints and does not use a browser" (see [`docs/00_Original_Challenge.md`](docs/00_Original_Challenge.md)). The live/deployed extraction path (`linkedinExtractor.ts`, `publicExtractor.ts`) only ever makes direct HTTP calls to LinkedIn's own endpoints, never browser automation. `playwrightExtractor.ts` was built and kept strictly as a **local-only diagnostic tool** — it's what confirmed the block was happening at LinkedIn's edge/CDN layer rather than being specific to the Voyager API shape (see above), not a candidate for the submitted solution. Independently, it also wouldn't be practical to deploy anyway: headless Chromium needs ~300–400MB RAM on top of the Node process, which risks OOM-crashing Render's free-tier instance (512MB total). Run it locally with `npm run extract:local -- <profile-url>` (needs `npx playwright install chromium` once).

## Project structure

```
public/
 └── index.html       minimal demo form (no framework/build step), served at GET /
src/
 ├── api/            routes, controllers, Fastify bootstrap
 ├── validation/      LinkedIn URL shape check + normalization
 ├── cache/           Redis client + get/set with TTL, fail-open
 ├── queue/           BullMQ producer (queue.ts) + consumer (worker.ts)
 ├── extraction/       ProfileExtractor interface + implementations (linkedin/public/playwright/mock)
 ├── formatter/        raw -> public schema mapping
 ├── services/        orchestrates cache -> queue -> formatter
 ├── errors/          error classes + centralized Fastify error handler
 ├── config/          single env loader
 └── types/           shared request/response/domain types
scripts/
 ├── tryPlaywrightExtractor.ts       local-only manual runner for playwrightExtractor.ts (npm run extract:local)
 └── probeLinkedinDashSections.ts    local-only raw-JSON dump of unverified section endpoints (npm run probe:linkedin)
tests/
 ├── unit/            validation, formatter, error handler, cache, queue error-mapping, extractors
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

- **LinkedIn's extraction surface is actively hostile right now, observed directly during this build, against multiple independent accounts/networks** — see [Extraction layer](#extraction-layer) for the full account. Concretely: the classic Voyager `profileView` REST endpoint returns `410 Gone` (LinkedIn has moved to an internal "SDUI"/React-Server-Components protocol instead); LinkedIn is currently serving a signup/login wall to anonymous (logged-out) profile views as well; and even a headless-browser workaround using real session cookies (`playwrightExtractor.ts`, local-only) is blocked earlier, by an infinite redirect at LinkedIn's edge layer, reproducible with plain `curl`. This isn't limited to one flagged account or IP: a second, entirely fresh account/session (different machine, different network, first-ever run) hit the same class of block on its very first request, and an anonymous request from a third, unrelated network to an unrelated public profile independently returned LinkedIn's own `HTTP 999` bot-block code around the same time. Given a real headless browser (full TLS/JS fingerprint, complete header set) hit the identical block, the evidence points to LinkedIn's automated-traffic defenses currently being broadly aggressive against this whole class of non-interactive access — not primarily a fingerprint-completeness or per-account-reputation issue this codebase can engineer around within its no-evasion constraint (no proxy rotation, no fingerprint spoofing, no CAPTCHA solving — see [Extraction layer](#extraction-layer)). The app handles every failure mode correctly (mapped to the right error code, never fabricated data), but no extraction path is guaranteed to return real data for a given profile/account/moment — this is the volatility risk called out below, not a bug in this codebase.
- **The authenticated and anonymous fallback used to fail into different, misleading HTTP codes for the same underlying block** (`429` vs `422` depending on which path's failure reached the client) — `worker.ts` was silently swallowing the authenticated extractor's real failure reason whenever the anonymous fallback also failed, masking that both paths had actually hit the same LinkedIn block. Fixed: on a double failure, the client now sees the authenticated path's error (the more accurate signal — e.g. an actual block — rather than the anonymous path's generic "unreachable").
- **Experience/education/skills/certifications/languages are implemented but never live-verified.** `publicExtractor` (anonymous JSON-LD) never had access to them at all. `linkedinExtractor` now fetches and parses all of them (see [Extraction layer](#extraction-layer), [T11](.wayfinder/tickets/T11-staffspy-field-mapping-findings.md)) using field mappings sourced from a real, actively-maintained open-source LinkedIn scraper's parsing code — not guessed — but the account used for this build has been consistently blocked at LinkedIn's edge, so these calls have never actually executed against a real response. Known gaps even once verified: no language-proficiency field (not sourced — see T11), education's `degree` is LinkedIn's raw combined "Degree, Field of study" string rather than split fields, and experience has no `description` field (not present in the sourced parsing logic). The response schema already supports these fields (omitted, not fabricated, when unavailable — same convention as everywhere else).
- **Render's free tier spins the instance down after inactivity** — the first request after a period of no traffic pays a cold-start delay (tens of seconds) before `/health` or `/api/v1/profile` responds; subsequent requests are fast. Not something this codebase can fix without a paid plan.
- **Single-region, single-instance deployment** — no horizontal scaling implemented (the architecture supports adding it later; see `docs/03_Architecture.md` §4).
- **No persistent database** — Redis is a cache with a TTL, not durable storage; a flush means re-fetching on next request.
- **No authentication/authorization** on the API itself — out of scope per the challenge, would be a next step for production.
- **Async job-status polling** (`GET /api/v1/profile/status/:jobId`) is designed for but not implemented — the current sync-with-timeout mode covers the challenge's requirements; the queue is structured so polling is a small addition later.
