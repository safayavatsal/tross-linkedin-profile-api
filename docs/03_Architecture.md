# Architecture Document
## LinkedIn Profile API — Tross Hiring Challenge

---

## 1. Architectural Style

A small, single-service backend with clearly separated internal layers — not microservices (unnecessary at this scope), but structured so each layer could become its own service later without a rewrite. This is intentional: it signals scalable thinking without over-engineering a 3-day take-home.

## 2. Component Architecture

| Layer | Technology | Notes |
|---|---|---|
| HTTP API | Node.js + TypeScript + Fastify | Schema validation built in, fast, matches candidate's existing stack |
| Cache | Redis | Key = normalized URL, TTL-based expiry |
| Job Queue | BullMQ (Redis-backed) | Retry/backoff, isolates slow/flaky extraction from request thread |
| Extraction | Isolated module behind `ProfileExtractor` interface | Implementation detail, independently owned |
| Container | Docker | Single Dockerfile, reproducible builds |
| Hosting | Render | Public HTTPS, fast path to a live deployment |

See `04_Architecture_Diagram.md` for visual diagrams of this topology.

## 3. Deployment Topology

- **Single container** running the Fastify API + BullMQ worker (in-process worker for this scope; separable into its own container later if needed).
- **Managed Redis** instance (Render add-on or equivalent) — used for both cache and BullMQ's backing store.
- **HTTPS** handled at the platform edge (Render provides this by default — no manual TLS config needed).
- **Environment variables** injected via Render's dashboard/secrets manager — never committed to the repo.

## 4. Scalability Considerations (documented, not necessarily implemented)

- API layer is stateless → horizontally scalable behind a load balancer if needed.
- Worker(s) can be split into a separate deployable process/container to scale extraction independently of API traffic.
- Redis is the single shared dependency between API and worker — becomes the natural place to look first if scaling further.
- These are called out in the README as "how this would evolve," which demonstrates forward thinking without spending take-home time building infrastructure that isn't needed yet.

## 5. Security Considerations

- No secrets in source control — `.env` gitignored, `.env.example` provided.
- Input validation at the edge prevents obviously malformed/malicious URLs from reaching internal logic.
- Rate limiting protects both the public API and the upstream dependency from abuse.
- Minimal PII in logs.

## 6. Why This Architecture Fits the Brief

- It directly maps to the challenge's own requirements (public HTTPS, structured JSON, README with approach/limitations).
- It matches the candidate's existing production experience (Node/TS, queue-based async processing, containerized deployment, Redis caching) — the architecture is a natural extension of real prior work, not a stack picked to impress.
- It scopes cleanly to 3 days: every component listed has a fast path to "working," with scaling/extension notes documented rather than built, which is itself a mark of judgment under a deadline.
