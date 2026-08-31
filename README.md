# Tross LinkedIn Profile API

A hosted HTTP API that accepts a LinkedIn profile URL and returns structured JSON (name, headline, location, about, experience, education, skills, certifications, languages, images). Built for the Tross engineering hiring challenge.

> **Extraction is real, not mocked.** An authenticated LinkedIn extractor with a no-login public fallback, both behind a swappable `ProfileExtractor` interface — see [Extraction layer](#extraction-layer).

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

<details>
<summary><strong>Stuck on <code>localhost:3000</code> after <code>docker compose up</code>, even though <code>docker ps</code> shows everything healthy? (macOS)</strong></summary>

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

</details>

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

The first call fetches through the extraction pipeline (`meta.source: "live"`); repeat the same URL and it's served from Redis (`meta.source: "cache"`).

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

Four implementations behind the same `ProfileExtractor` interface (`src/extraction/ProfileExtractor.interface.ts`). `src/queue/worker.ts` chooses between the two *deployed* ones per request, with automatic fallback — there is no mock/fake data anywhere in the live request path.

| Extractor | Used when | What it does |
|---|---|---|
| `linkedinExtractor.ts` | Tried first, whenever credentials are configured | Authenticated calls straight to LinkedIn's internal APIs — full data. See below. |
| `publicExtractor.ts` | No credentials set, **or** as automatic fallback if `linkedinExtractor` fails | Reads the schema.org `JSON-LD` block on the public profile page — real but partial data, no login. |
| `playwrightExtractor.ts` | Local-only, manual (`npm run extract:local -- <url>`) | Headless-browser diagnostic tool. **Never** deployed or on the request path — see why below. |
| `mockExtractor.ts` | Test suite only | Fixture data so tests don't need network access or real credentials. |

### `linkedinExtractor.ts` — confirmed live-working end to end against a real account (2026-08-31)

Two calls into two different LinkedIn systems, both real and unofficial/reverse-engineered:

- **Top card** (name, headline, location, photo) — LinkedIn's internal Voyager **"Dash"** API (`voyagerIdentityDashProfiles`, `decorationId=...TopCardComplete-138`). The response is `{data, included}`; the profile record lives in `included`, keyed by `$recipeTypes` naming `TopCardComplete`. Location is a second-hop lookup through a separate geo entity elsewhere in `included`.
- **Deep sections** (about, experience, education, skills, certifications, languages) — a different system: LinkedIn's React Server Components **"Flight protocol"** rendering pipeline (`linkedinFlightProtocol.ts`), fetched via `POST /flagship-web/rsc-action/actions/component`. Content isn't named JSON fields — it's plain rendered text recovered by pattern-matching a handful of recurring component shapes (see that module's docstring). Each section is fetched and fails independently: a bad parse or a `500` on one section just omits that field, never fails the whole request.
  - **Multi-position grouping:** LinkedIn groups promotions at one company under a single header (title = company name, subtitle = "Employment type · total duration"), followed by title-only position entries. `parseExperience` (`linkedinSectionParsers.ts`) detects that header shape by its employment-type vocabulary and carries the company forward onto each position beneath it.
  - **Multi-paragraph text:** About and job/education descriptions render as a nested array of line segments, not one string — reconstructed by recursively joining the segments.
  - **Experience pagination:** the section response above is a capped *preview*; on a profile with enough history it drops entries past the first page. Experience additionally fetches LinkedIn's own "see all" details page for the complete list, and still sources descriptions from the clean preview response (the details page interleaves full site chrome into the list, so its own description positions aren't trustworthy).

  Both calls are gated by a self-imposed pacing module (`linkedinPacing.ts`: a minimum interval between calls, plus a cooldown after any detected block) — disciplined pacing, not evasion tooling, since LinkedIn's blocking is account-level and behavior-based rather than fingerprint-based.

  The full story behind each of the three bullets above — what broke, how it was diagnosed, how it was fixed — is in [`docs/08_Risk_Limitations.md` §7 Incident History](docs/08_Risk_Limitations.md#7-incident-history).

### `publicExtractor.ts`

No login needed. Real data, but much less of it: name, headline, current company/location, about, photo — experience/education/skills/certifications/languages aren't exposed to anonymous visitors, so those keys are omitted (same null-vs-omission convention as everywhere else).

### `playwrightExtractor.ts` — why it isn't deployed

First and foremost, it isn't allowed to be: the challenge's official clarification email states the solution must be "a purely reverse-engineered solution that directly hits LinkedIn endpoints and does not use a browser" (see [`docs/00_Original_Challenge.md`](docs/00_Original_Challenge.md)). It was built and kept strictly as a **local-only diagnostic** — it's what confirmed an early block was happening at LinkedIn's edge/CDN layer rather than being specific to the Voyager API shape (see the incident history linked above), not a candidate for the submitted solution. It also wouldn't be practical to deploy anyway: headless Chromium needs ~300–400MB RAM on top of the Node process, risking an OOM crash on Render's free-tier instance (512MB total). Run it with `npm run extract:local -- <profile-url>` (needs `npx playwright install chromium` once).

### Real (authenticated) extraction setup

1. Log into linkedin.com in your browser.
2. Open devtools → Application/Storage → Cookies → `https://www.linkedin.com`.
3. Copy the values of the `li_at` and `JSESSIONID` cookies (the latter includes surrounding quotes in the browser — set the env var **without** the quotes).
4. Set `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` in `.env` (or Render's environment variables). `docker-compose up` reads the same repo-root `.env` automatically — just restart the stack after editing it.
5. Leave both unset (or if the authenticated call fails) and the app still returns real, if partial, data via `publicExtractor` — no setup required, and no hard failure either way.
6. `npm run probe:linkedin -- <profile-url>` — diagnostic-only, local, not part of the request path. Fetches the top-card call plus every Flight-protocol section (`scripts/probeLinkedinDashSections.ts`) and prints each raw response — useful for re-checking `linkedinFlightProtocol.ts`'s parsers against a real response shape whenever LinkedIn's next frontend rebuild rotates the componentId names or CSS-in-JS class markers this parsing keys off of.

**On credential lifetime and how this is meant to be evaluated:** the challenge brief explicitly says *"you may use your own LinkedIn credentials in the backend"* — these credentials live only in the deployment's environment variables (Render's, in this submission), never in the evaluator's hands. Whoever tests the live public URL just POSTs a profile URL; they never need to supply `li_at`/`JSESSIONID` themselves. `li_at` is long-lived by design (LinkedIn sets it to persist roughly a year), but if it expires, gets revoked, or the account gets flagged before this is evaluated, the authenticated path fails closed into `publicExtractor` (step 5 above) rather than breaking the deployed service. Anyone who prefers to test with their *own* live session can clone the repo and follow steps 1–4 with their own account. Full detail: [`docs/08_Risk_Limitations.md` §3a](docs/08_Risk_Limitations.md#3a-credential-lifetime--how-this-is-meant-to-be-evaluated).

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

83 tests across 12 files: URL validation (valid/invalid/normalization), the Flight-protocol wire-format parser and section parsers, both extractors, formatter (null vs. omission convention), centralized error handler (each `AppError` → correct status/shape), and a full integration test that exercises `POST /api/v1/profile` end-to-end through the real stub extractor, Redis cache, and BullMQ queue/worker (requires a reachable Redis, same as running the app).

## Deployment

Target: [Render](https://render.com), via the repo's `Dockerfile`. Full steps, including every environment variable to set: [`docs/DEPLOY.md`](docs/DEPLOY.md).

```bash
npm run build   # tsc -> dist/
npm start        # node dist/api/server.js
```

## Known limitations

Full write-up, including the incident history behind the fixes below: [`docs/08_Risk_Limitations.md`](docs/08_Risk_Limitations.md). Current-state highlights:

- **LinkedIn's extraction surface is genuinely volatile.** Three rounds of real breakage since first deploying — a stale-cookie block, a retired GraphQL query, and two parsing bugs of its own — all resolved and verified live as of 2026-08-31. Full account of each: [`docs/08_Risk_Limitations.md` §7](docs/08_Risk_Limitations.md#7-incident-history).
- Neither shipped extractor does bot-detection evasion — no proxy rotation, no fingerprint spoofing, no CAPTCHA solving.
- **Experience/education/skills/certifications/languages/about are confirmed live-verified** via LinkedIn's Flight-protocol component actions. No language-proficiency field is surfaced (languages return name only). Education's `degree` is LinkedIn's raw combined "Degree, Field of study" string, unsplit.
- **On a double failure** (authenticated extractor fails, then the anonymous fallback also fails), the client sees the authenticated path's error — the more accurate signal, e.g. an actual LinkedIn block — rather than the fallback's generic "unreachable". `worker.ts` used to silently swallow the authenticated failure reason in this case, masking that both paths had hit the same underlying block; fixed.
- **Render's free tier spins the instance down after inactivity** — the first request after a period of no traffic pays a cold-start delay (tens of seconds) before `/health` or `/api/v1/profile` responds; subsequent requests are fast. Not something this codebase can fix without a paid plan.
- **Single-region, single-instance deployment** — no horizontal scaling implemented (the architecture supports adding it later; see `docs/03_Architecture.md` §4).
- **No persistent database** — Redis is a cache with a TTL, not durable storage; a flush means re-fetching on next request.
- **No authentication/authorization** on the API itself — out of scope per the challenge, would be a next step for production.
- **Async job-status polling** (`GET /api/v1/profile/status/:jobId`) is designed for but not implemented — the current sync-with-timeout mode covers the challenge's requirements; the queue is structured so polling is a small addition later.
