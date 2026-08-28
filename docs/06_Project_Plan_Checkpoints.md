# Project Plan, Checkpoints & Error Handling
## LinkedIn Profile API — Tross Hiring Challenge

Deadline: Monday, 31 August

---

## 1. Day-by-Day Plan

### Day 1 — Foundation & Deploy Skeleton
- [ ] Repo scaffold (folder structure per `05_Folder_Structure.md`)
- [ ] Fastify server boots with a `/health` endpoint
- [ ] Dockerfile written, builds and runs locally
- [ ] Deployed bare skeleton live on Render (public HTTPS reachable)
- [ ] Redis provisioned and reachable from the app
- [ ] `.env.example` + config loader in place
- **Checkpoint:** a public URL exists that responds `200 OK` on `/health` before end of Day 1.

### Day 2 — Core Logic
- [ ] Input validation implemented + tested
- [ ] `ProfileExtractor` interface defined
- [ ] Extraction implementation (independent work) wired behind the interface
- [ ] Cache read/write wired around extraction call
- [ ] BullMQ queue + worker wired (sync-with-timeout mode)
- [ ] Formatter maps raw → public schema, missing-field convention applied consistently
- **Checkpoint:** a real LinkedIn profile URL returns structured JSON end-to-end (locally at minimum).

### Day 3 — Hardening, Docs, Submission
- [ ] Centralized error handling matrix implemented (see below)
- [ ] Rate limiting added at API layer
- [ ] Tests for validation, formatter, and error mapping
- [ ] README written (setup, API docs, approach, known limitations)
- [ ] Final deploy verified against the live public URL
- [ ] Repo cleaned: no secrets, no debug logs, no dead code
- [ ] Submit via Tally form
- **Checkpoint:** submission complete with buffer time before the deadline, not at the deadline.

## 2. Task Breakdown by Priority

| Priority | Task | Owner |
|---|---|---|
| P0 | Public health-check deploy | Shared setup |
| P0 | API contract (request/response schema) | Design (done — see `07_API_Contract.md`) |
| P0 | Extraction interface + your implementation | Independent |
| P0 | Error handling matrix | Shared setup |
| P1 | Redis caching | Shared setup |
| P1 | BullMQ queue/worker | Shared setup |
| P1 | README | Shared setup |
| P2 | Rate limiting | Shared setup |
| P2 | Tests | Shared setup |
| P3 | Minimal demo HTML page | Optional |
| P3 | Async job-status polling endpoint | Optional / stretch |

## 3. Error Handling Matrix

| Scenario | Detection Point | Response | Logged? |
|---|---|---|---|
| Malformed LinkedIn URL | Validation layer | `400` + message | Yes |
| Profile does not exist | Extraction layer | `404` + message | Yes |
| Profile private/restricted | Extraction layer | `422` + message | Yes |
| Upstream rate-limited | Extraction layer | `429` + `Retry-After` hint | Yes |
| Extraction takes too long | Timeout wrapper | `504` + message | Yes |
| Redis unavailable | Cache layer | Bypass cache, proceed to extraction (fail open, log warning) | Yes |
| Unexpected exception | Global error handler | `500` + generic message (no stack trace to client) | Yes, with stack trace server-side only |
| Partial data (some sections missing) | Formatter | `200` with explicit `null`/omitted fields, not an error | Optional (info-level) |

## 4. Definition of Done (for submission)

- [ ] API is live and publicly reachable over HTTPS.
- [ ] A valid LinkedIn profile URL returns structured JSON matching the documented schema.
- [ ] Invalid/edge-case inputs return the documented error shapes, not crashes.
- [ ] No secrets exist anywhere in the repository (double-check `git log` too, not just current files).
- [ ] README is complete: setup, API docs, approach, known limitations.
- [ ] Repo is public and the submission link is submitted through the Tally form before the deadline.

## 5. Risk Register (things that could derail the 3-day window)

| Risk | Mitigation |
|---|---|
| Extraction approach proves harder than expected | Time-box investigation; if blocked, document the attempted approach and partial results honestly in README rather than submitting nothing |
| Render deploy issues eat a day | Deploy the skeleton on Day 1, not Day 3, so problems surface early |
| Scope creep (frontend, extra features) | Stick to P0/P1 tasks; P2/P3 only if time remains |
| LinkedIn blocks/rate-limits during testing | Test sparingly, cache aggressively during dev, avoid repeated calls against the same profile |
