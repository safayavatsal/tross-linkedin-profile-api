# High-Level Design (HLD)
## LinkedIn Profile API — Tross Hiring Challenge

---

## 1. Purpose

Build a publicly hosted HTTP API that accepts a LinkedIn profile URL and returns structured JSON containing the profile's publicly visible information (name, headline, location, about, experience, education, skills, certifications, languages, images).

## 2. Goals

- Return accurate, structured profile data for a given LinkedIn URL.
- Be deployed and reachable over public HTTPS.
- Behave predictably under partial data, invalid input, and upstream failure.
- Be documented and structured well enough that a stranger (the reviewer) can run it and understand it in minutes.

## 3. Non-Goals

- Bulk/mass scraping of multiple profiles in parallel.
- Building a LinkedIn clone UI or full frontend product.
- Guaranteeing 100% field completeness for every profile (some sections are inherently private or inconsistent).
- Long-term data warehousing of scraped profiles (this is a lookup service, not a data lake).

## 4. System Context

```
[Client / Reviewer]
        |
        |  POST /api/v1/profile { linkedin_url }
        v
[ Tross Profile API ]  <-- this project
        |
        |  (internal) checks cache, queues job if needed
        v
[ Extraction Service ]  <-- isolated module, owned independently
        |
        v
[ LinkedIn ]
```

The API is the product being evaluated. The Extraction Service is treated as a pluggable, isolated dependency — this separation is intentional (see Section 7).

## 5. Major Components

| Component | Responsibility |
|---|---|
| API Layer (Fastify) | Request handling, validation, routing, response shaping |
| Validation Layer | Confirms input is a well-formed LinkedIn profile URL |
| Cache (Redis) | Avoids redundant fetches; serves recently-fetched profiles instantly |
| Queue (BullMQ) | Manages extraction jobs asynchronously, handles retries/backoff |
| Extraction Service | Fetches raw profile data (implementation detail, isolated behind interface) |
| Formatter/Mapper | Converts raw extracted data into the public response schema |
| Error Handler | Centralized mapping of failure states to consistent API error responses |
| Logger/Observability | Structured logs for request lifecycle and failures |

## 6. High-Level Data Flow

1. Client sends `POST /api/v1/profile` with a LinkedIn URL.
2. Validation layer confirms URL shape; rejects malformed input immediately (fast fail).
3. Cache is checked using the normalized URL as key.
   - **Cache hit** → return immediately.
   - **Cache miss** → proceed.
4. A job is enqueued (or executed synchronously for MVP, see LLD) to fetch profile data.
5. Extraction Service retrieves raw data.
6. Formatter maps raw data into the public JSON schema, marking missing fields explicitly.
7. Result is cached (with TTL) and returned to the client.
8. Any failure at any stage is caught and mapped to a structured error response.

## 7. Design Principle: Isolation of the Extraction Layer

The extraction mechanism is deliberately isolated behind a single interface (`ProfileExtractor.fetch(url)`), because:

- It is the most volatile part of the system (LinkedIn's page structure can change).
- It is the highest-risk part of the system from a ToS standpoint.
- Isolating it means the rest of the system (API, cache, queue, error handling) is testable and demonstrable independent of that specific implementation.

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Availability | Publicly reachable over HTTPS, single-region acceptable for this scope |
| Performance | Cached responses < 200ms; cold fetches bounded by timeout + retry policy |
| Reliability | Graceful degradation — partial data returned rather than hard failure where possible |
| Security | No secrets in repo; credentials via environment variables only |
| Observability | Structured logs per request; job status visible for async path |
| Rate Sensitivity | Built-in throttling to avoid abusive request patterns against the extraction layer |

## 9. Assumptions & Constraints

- Single active LinkedIn session/credential set is used server-side (per challenge instructions).
- No user authentication is required for calling this API (out of scope per challenge).
- Deadline (3 days) constrains scope to a single-region, single-instance deployment — horizontal scaling is discussed but not implemented.
- LinkedIn's page structure/response shape is not officially documented and may change; this is called out explicitly in Known Limitations.

## 10. Related Documents

- `02_LLD.md` — module-level design, interfaces, sequence details
- `03_Architecture.md` — component architecture and deployment topology
- `04_Architecture_Diagram.md` — visual diagrams (system, sequence, deployment)
- `05_Folder_Structure.md` — repository layout
- `06_Project_Plan_Checkpoints.md` — day-by-day plan, task list, error-handling matrix
- `07_API_Contract.md` — request/response schema and error contract
- `08_Risk_Limitations.md` — known limitations and risk mitigation notes
