# Build Tasks
## LinkedIn Profile API — derived from `06_Project_Plan_Checkpoints.md`

Executed by an automated multi-agent build. Checked off as agents complete work.

## Phase 0 — Foundation (done by orchestrator directly)
- [x] `git init`, `docs/` populated with design docs
- [x] This task list

## Phase 1 — Scaffold (Scaffold Agent)
- [x] Folder structure per `05_Folder_Structure.md`
- [x] `package.json`, `tsconfig.json`
- [x] `.env.example`, `.gitignore` (no secrets ever committed)
- [x] `src/config/index.ts` — single env loader
- [x] `src/types/profile.types.ts` — `RawProfileData`, public `Profile` schema types
- [x] `src/errors/errorTypes.ts` — error classes per LLD §8 error matrix
- [x] `src/extraction/ProfileExtractor.interface.ts` — interface only

## Phase 2 — Parallel core layers

### API & Validation Agent
- [x] `src/validation/linkedinUrl.validator.ts` — URL shape check + normalization
- [x] `src/api/server.ts` — Fastify bootstrap, rate limiting (`@fastify/rate-limit`)
- [x] `src/api/routes/health.routes.ts`, `GET /health`
- [x] `src/api/routes/profile.routes.ts`, `POST /api/v1/profile`
- [x] `src/api/controllers/profile.controller.ts` (calls `ProfileService`, wired in Phase 3)

### Cache & Queue Agent
- [x] `src/cache/redisClient.ts`
- [x] `src/cache/profileCache.ts` — get/set by `profile:{normalized_url}`, TTL, fail-open on Redis down
- [x] `src/queue/queue.ts` — BullMQ queue producer
- [x] `src/queue/worker.ts` — BullMQ worker, retry/backoff, calls extractor

### Extraction Stub & Formatter Agent
- [x] `src/extraction/implementation/mockExtractor.ts` — stub `ProfileExtractor`, clearly marked, realistic sample data
- [x] `src/formatter/profileFormatter.ts` — raw → public schema, null/omission convention

## Phase 3 — Integration & Error Handling (sequential, depends on Phase 2)
- [x] `src/services/profileService.ts` — orchestrates cache → queue/worker (sync-with-timeout) → format → cache write
- [x] `src/errors/errorHandler.ts` — centralized Fastify error handler, maps error matrix → response shape
- [x] Wire `profile.controller.ts` to `ProfileService`

## Phase 4 — Tests & DevOps (parallel, depends on Phase 3)

### Testing Agent
- [x] `tests/unit/validation.test.ts`
- [x] `tests/unit/formatter.test.ts`
- [x] `tests/unit/errorHandler.test.ts`
- [x] `tests/integration/profile.route.test.ts` (full route, stub extractor)

### DevOps Agent
- [x] `Dockerfile`
- [x] `docker-compose.yml` (app + Redis)
- [x] Verify `docker-compose up` end-to-end
- [x] Render deployment notes (env vars, build/start commands)

## Phase 5 — Docs
- [x] `README.md` — setup, API docs, approach summary, Known Limitations (from `08_Risk_Limitations.md`)
- [x] `docs/DEPLOY.md` — Render deploy steps

## Phase 6 — Verification (orchestrator)
- [x] `npm install && npm run dev` boots locally
- [x] `docker-compose up` → `/health` 200 — verified live (app + Redis containers, health check, live extraction, cache hit, malformed-URL 400 all confirmed via curl against the running stack). Along the way, fixed `tsconfig.build.json`/`rootDir` so `tsc` emits to `dist/api/server.js` (matching the Dockerfile's `CMD`) instead of `dist/src/api/server.js`.
- [x] `POST /api/v1/profile` with LinkedIn-shaped URL → 200 matching schema (verified manually + integration test)
- [x] Malformed URL → documented 400 shape (verified manually + integration test)
- [x] `npm test` passes (25/25)
- [x] No secrets committed (`.env` gitignored, only `.env.example` tracked)
- [x] README accurate to what was actually built
