# Tross LinkedIn Profile API

A hosted HTTP API that accepts a LinkedIn profile URL and returns structured JSON (name, headline, location, about, experience, education, skills, certifications, languages, images). Built for the Tross engineering hiring challenge.

> **Extraction is real, not mocked** — an authenticated LinkedIn Voyager extractor with a no-login public fallback, both behind a swappable `ProfileExtractor` interface. See [Extraction layer](#extraction-layer) for what each does, how to enable the authenticated path, and — importantly — a concrete account of the extraction surface being actively hostile right now (LinkedIn's REST API returning `410 Gone`, anonymous views hitting a signup wall) discovered while building this.

## Contents

- [Quick start](#quick-start)
- [API](#api)
- [Approach](#approach)
- [Extraction layer](#extraction-layer)
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

**Stuck on `localhost:3000` after `docker compose up`, even though `docker ps` shows everything running/healthy?** See [Troubleshooting: Docker reports healthy but `localhost:3000` won't load (macOS)](#troubleshooting-docker-reports-healthy-but-localhost3000-wont-load-macos) below.

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

### Troubleshooting: Docker reports healthy but `localhost:3000` won't load (macOS)

**Symptom:** `docker compose ps` shows both containers `Up`/`healthy`, `docker compose logs app` shows `Server listening at http://127.0.0.1:3000`, but the browser hangs indefinitely on `localhost:3000` and `curl http://127.0.0.1:3000/health` fails outright with:

```
curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Couldn't connect to server
```

**This is not a bug in this project.** It's a macOS networking issue, seen in the wild while testing this exact setup: a VPN or corporate security client (Zscaler, Cisco AnyConnect, and similar tools are known to do this) has hijacked the `lo0` loopback interface and removed the standard `127.0.0.1` address, replacing it with something like `10.10.10.1`. Every app on the machine — not just this one — becomes unreachable at `localhost`/`127.0.0.1` until it's fixed, because the failure happens at the OS socket layer, before the connection ever reaches Docker's port mapping.

**Diagnose it:**

1. Confirm the app really is listening and Redis is reachable (rules out an app-level hang):
   ```bash
   docker compose -f docker/compose/docker-compose.yml logs app   # look for "Server listening at http://127.0.0.1:3000"
   docker compose -f docker/compose/docker-compose.yml exec redis redis-cli ping   # expect PONG
   ```
2. Confirm Docker's port mapping is correct (rules out a Docker-config issue):
   ```bash
   docker ps   # look for 0.0.0.0:3000->3000/tcp in the app container's PORTS column
   ```
3. Check whether `127.0.0.1` actually exists on the loopback interface — this is the tell:
   ```bash
   ifconfig lo0 | grep "inet "
   ```
   If you see something like `inet 10.10.10.1 netmask 0xffffffff` and **no** `127.0.0.1` line at all, that confirms it.

**Fix it:**

```bash
sudo ifconfig lo0 alias 127.0.0.1 up
```

This adds `127.0.0.1` back as an additional address on `lo0` alongside whatever the VPN added — it doesn't remove or fight the VPN's own address, so it's safe to run. Verify with `ifconfig lo0 | grep "inet "` (you should now see both addresses) and `curl http://127.0.0.1:3000/health`.

**Not permanent** — a VPN reconnect or a reboot can re-apply the hijack, so you may need to re-run the command after either. If this happens repeatedly on a work machine, it's worth flagging to IT — the VPN client's behavior is the root cause, not something any app can fix on its own.

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

- **`linkedinExtractor.ts`** (tried first, when configured) — **confirmed live-working end to end against a real account (2026-08-31)**, after the edge-level block that dogged this build for its first three days turned out to be a stale, over-used session cookie rather than a permanent account ban (see [Known limitations](#known-limitations)). Two calls into two different systems, both real:
  - **Top card** (name, headline, location, photo): LinkedIn's internal Voyager **"Dash"** API (`voyagerIdentityDashProfiles`, `decorationId=...TopCardComplete-138`). This replaces an earlier version that called the classic `profileView` REST endpoint, which returned `410 Gone` during this build. Verified live: the actual response shape is `{data, included}` (not the `{elements}` shape first assumed) — the profile record lives in `included`, keyed by `$recipeTypes` naming `TopCardComplete`; location is a second-hop lookup through a separate geo entity elsewhere in `included`.
  - **Deep sections** (about, experience, education, skills, certifications, languages): a completely different system — LinkedIn has migrated this part of the profile page to a React Server Components **"Flight protocol"** rendering pipeline (`linkedinFlightProtocol.ts`), fetched via `POST /flagship-web/rsc-action/actions/component`. The Voyager GraphQL "ProfileComponentsBySectionType" query this project used before is dead (confirmed live: `HTTP 500` from LinkedIn's own backend, and no longer referenced by any client JS the profile page currently loads). Content in a Flight response isn't named JSON fields — it's plain rendered text recovered by pattern-matching a handful of recurring component shapes (see the module's docstring). Each section is fetched independently and fails independently — a bad parse or a `500` on one section just omits that field, never fails the whole request. **Multi-position grouping:** LinkedIn groups promotions at one company under a single header in its UI (title = company name, subtitle = "Employment type · total duration", no company info at all) followed by title-only position entries with no subtitle of their own. `parseExperience` (`linkedinSectionParsers.ts`) detects that header shape — subtitle starting with one of LinkedIn's fixed employment-type words (Full-time, Part-time, Self-employed, ...) rather than a company name — and carries its title forward as the company for each position that follows, dropping the header itself. Verified live against a real multi-position profile. **Multi-paragraph text (About, descriptions):** LinkedIn doesn't render a long text block as one string — it's a nested array of one segment per line, each optionally preceded by a `<br/>`. The parser flattens that back into a single newline-joined string; the earlier version only handled the single-string case and silently returned `null` for every profile with real paragraph breaks in About or a job/education description. **Experience pagination:** the rsc-action response above is a *preview* — every section carries a `paginationNeeded:true` flag and a "See all" link to `/in/{id}/details/{section}/`, and on a profile with enough history the preview genuinely drops entries past the first page (verified live: a 19-position profile came back with 9). Experience additionally fetches that details page — a full HTML page, but the real data is the same Flight wire format embedded as `window.__como_rehydration__ = [...]` — for the complete list; since that page also renders full site chrome (global nav, a "who viewed your profile" rail) interleaved with the real list, its own description text isn't positionally trustworthy, so descriptions still come from the clean preview response, matched back onto the full list by (title, dates). Education/skills/certifications/languages were checked against the same account and came back complete from the preview alone, so only experience pays for the extra call — see `linkedinFlightProtocol.ts` if a future profile needs the same treatment for one of those.

  Both calls are gated by a small self-imposed pacing module (`linkedinPacing.ts`: a minimum interval between calls plus a cooldown window after any detected block — LinkedIn's own blocking is account-level and behavior-based, not fingerprint-based, so disciplined pacing is the mitigation, not evasion tooling). `worker.ts` tries this path first whenever credentials are configured, falling back to `publicExtractor` on any failure.
- **`publicExtractor.ts`** (used when no credentials are set, **and** automatically as a fallback if `linkedinExtractor` fails for any reason) — no login needed. Reads the schema.org `JSON-LD` block LinkedIn embeds on public profile pages for search-engine indexing. Real data, but much less of it: name, headline, current company/location, about, photo — experience/education/skills/certifications/languages aren't exposed to anonymous visitors, so those keys are omitted (same null-vs-omission convention as everywhere else).
- **`playwrightExtractor.ts`** (local-only, **not** deployed — see below) — renders the real profile page in headless Chromium with your session cookies and scrapes the hydrated DOM, instead of parsing LinkedIn's internal API responses. Run it with `npm run extract:local -- <profile-url>`.
- **`mockExtractor.ts`** — not used at runtime. Kept only as a fixture for the unit/integration test suite (`tests/unit/formatter.test.ts`, etc.), so tests don't depend on network access or real credentials.

### Real (authenticated) extraction setup

1. Log into linkedin.com in your browser.
2. Open devtools → Application/Storage → Cookies → `https://www.linkedin.com`.
3. Copy the values of the `li_at` and `JSESSIONID` cookies (the latter includes surrounding quotes in the browser — set the env var **without** the quotes).
4. Set `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` in `.env` (or Render's environment variables). `docker-compose up` reads the same repo-root `.env` automatically — just restart the stack after editing it.
5. Leave both unset (or if the authenticated call fails) and the app still returns real, if partial, data via `publicExtractor` — no setup required, and no hard failure either way.
6. `npm run probe:linkedin -- <profile-url>` — diagnostic-only, local, not part of the request path. Fetches the top-card call plus every Flight-protocol section (`scripts/probeLinkedinDashSections.ts`) and prints each raw response — useful for re-checking `linkedinFlightProtocol.ts`'s parsers against a real response shape whenever LinkedIn's next frontend rebuild rotates the componentId names or CSS-in-JS class markers this parsing keys off of.

**On credential lifetime and how this is meant to be evaluated:** the challenge brief explicitly says *"you may use your own LinkedIn credentials in the backend"* — the intended model is that these credentials live only in the deployment's environment variables (Render's, in this submission), never in the evaluator's hands. Whoever tests the live public URL just POSTs a profile URL; they never need to supply `li_at`/`JSESSIONID` themselves. `li_at` is a long-lived cookie by design (LinkedIn sets it to persist roughly a year) and doesn't rotate on every login/refresh under normal circumstances — but if it does expire, get revoked, or the account gets flagged between submission and whenever this is actually evaluated, the authenticated path fails closed into `publicExtractor` (step 5 above) rather than breaking the deployed service — no credentials needed for that fallback, and no hard failure either way. Anyone who prefers to test with their *own* live session instead of relying on the deployed credentials can clone the repo and follow steps 1–4 above with their own account.

Both are unofficial and reverse-engineered — see [Known Limitations](#known-limitations). **The three-day block, and how it actually resolved:** LinkedIn's classic Voyager `profileView` REST endpoint returned `410 Gone` against a live authenticated session; its Dash sibling and even the plain profile HTML page then hit a hard edge-level block (an infinite `302` self-redirect, reproducible with plain `curl` — no Playwright, no browser fingerprint involved) on every attempt across 2026-08-29 and 2026-08-30, including after a clean 48h account cool-down. That pointed at a broad, account-wide defense with no engineerable way around it. It turned out to be neither: the block was tied to that specific, over-used session cookie (repeated automated-looking traffic against it during three days of testing), not the account itself — a normal, human browser session using the same account worked the entire time. **Refreshing `LINKEDIN_LI_AT`/`LINKEDIN_JSESSIONID` from a live, working browser session cleared the block immediately** (2026-08-31) — the top-card call, the plain profile page, and every Flight-protocol section call all returned real data on the first try with the new cookie. Practical implication: if the deployed credentials ever start hitting this same infinite-redirect signature again, the fix is a fresh cookie pull (README steps above), not a longer wait.

**The old GraphQL "sections" endpoint is separately dead, for an unrelated reason.** Once the session was working, `voyagerIdentityDashProfileComponents` (the query this project originally sourced for experience/education/skills/certifications) returned `HTTP 500` straight from LinkedIn's own backend (`java.lang.RuntimeException: A record in the included list does not have a type`) — not a block, a genuinely retired query. Checking the live profile page's own JS bundles confirmed it: none of them reference that query anymore. LinkedIn has migrated this entire part of the profile page to a React Server Components **"Flight protocol"** rendering system instead (`linkedinFlightProtocol.ts`) — the same system briefly investigated and set aside earlier in this build as a curiosity; it's now the real, current path, and every section (about/experience/education/skills/certifications/languages) is confirmed live through it.

Neither shipped extractor does bot-detection evasion (no proxy rotation, no fingerprint spoofing, no CAPTCHA solving, no headless browser in the request path) — just plain, direct HTTP calls to LinkedIn's own endpoints, authenticated or anonymous.

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
 └── probeLinkedinDashSections.ts    local-only raw dump of the top-card + Flight-protocol section responses (npm run probe:linkedin)
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

- **LinkedIn's extraction surface is genuinely volatile — this build hit two unrelated failure classes in three days, both now resolved, but the underlying volatility isn't something a codebase can fix once and for all.** (1) An edge-level block that looked account-wide (infinite redirect, reproducible even with plain `curl`, surviving a 48h cool-down) turned out to be tied to one over-used session cookie, not the account — refreshing the session cookie from a normal browser session cleared it immediately. (2) Independently, LinkedIn retired the GraphQL query this project used for experience/education/skills/certifications (confirmed: `HTTP 500` straight from LinkedIn's backend, and no current client JS bundle references it anymore) in favor of a React Server Components rendering system, requiring a rewrite of that whole code path (`linkedinFlightProtocol.ts`). See [Extraction layer](#extraction-layer) for the full account of both. Neither shipped extractor does bot-detection evasion (no proxy rotation, no fingerprint spoofing, no CAPTCHA solving). The app handles every failure mode correctly (mapped to the right error code, never fabricated data), but there's no guarantee LinkedIn's frontend build or blocking behavior stays this way — that's the ongoing risk, not a bug in this codebase.
- **The authenticated and anonymous fallback used to fail into different, misleading HTTP codes for the same underlying block** (`429` vs `422` depending on which path's failure reached the client) — `worker.ts` was silently swallowing the authenticated extractor's real failure reason whenever the anonymous fallback also failed, masking that both paths had actually hit the same LinkedIn block. Fixed: on a double failure, the client now sees the authenticated path's error (the more accurate signal — e.g. an actual block — rather than the anonymous path's generic "unreachable").
- **Experience/education/skills/certifications/languages/about are now confirmed live-verified** (2026-08-31, see [Extraction layer](#extraction-layer)) via LinkedIn's Flight-protocol component actions — a full rewrite of the parsing layer originally sourced from a different (now-dead) GraphQL query, including correctly attributing grouped multi-position roles (promotions at one company) to their real company rather than mixing up title/company/duration. No language-proficiency field is surfaced (languages return name only). Education's `degree` is LinkedIn's raw combined "Degree, Field of study" string, unsplit.
- **Fixed 2026-08-31: About and experience/education descriptions came back `null`, and long experience histories were truncated.** Two separate bugs, both in `linkedinFlightProtocol.ts`, found from a real user report against a profile with 19 positions and full paragraph-length descriptions everywhere. (1) LinkedIn renders multi-paragraph text as a nested array of line segments, not one string — the parser only handled the single-string case, so About and every description came back `null` on any profile with real paragraph breaks (most of them). (2) The rsc-action preview response for each section is capped (`paginationNeeded:true` + a "See all" link) and silently drops entries past the first page; on this profile it returned 9 of 15 real positions. Experience now also fetches the linked details page for the complete list, since its own descriptions aren't reliable (see [Extraction layer](#extraction-layer)) — its own description text is dropped and descriptions are still sourced from the preview, matched by (title, dates) rather than by position. Education/skills/certifications/languages didn't hit the same cap on this account and still come from the preview alone; if a future profile has more of those than fit on one page, the same details-page approach is the pattern to extend.
- **Render's free tier spins the instance down after inactivity** — the first request after a period of no traffic pays a cold-start delay (tens of seconds) before `/health` or `/api/v1/profile` responds; subsequent requests are fast. Not something this codebase can fix without a paid plan.
- **Single-region, single-instance deployment** — no horizontal scaling implemented (the architecture supports adding it later; see `docs/03_Architecture.md` §4).
- **No persistent database** — Redis is a cache with a TTL, not durable storage; a flush means re-fetching on next request.
- **No authentication/authorization** on the API itself — out of scope per the challenge, would be a next step for production.
- **Async job-status polling** (`GET /api/v1/profile/status/:jobId`) is designed for but not implemented — the current sync-with-timeout mode covers the challenge's requirements; the queue is structured so polling is a small addition later.
