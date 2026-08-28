# Architecture Diagrams
## LinkedIn Profile API — Tross Hiring Challenge

These are written in [Mermaid](https://mermaid.js.org/) syntax, which renders natively on GitHub — paste this file directly into the repo and the diagrams will render in the README/docs without any image export needed.

---

## 1. System Component Diagram

```mermaid
flowchart LR
    Client([Client / Reviewer]) -->|POST /api/v1/profile| API[Fastify API Layer]
    API --> Validate[Validation Layer]
    Validate -->|invalid| ErrClient[400 Error Response]
    Validate -->|valid| Cache[(Redis Cache)]
    Cache -->|hit| API
    Cache -->|miss| Queue[BullMQ Job Queue]
    Queue --> Worker[Extraction Worker]
    Worker --> Extractor[[ProfileExtractor Interface]]
    Extractor --> LinkedIn[(LinkedIn)]
    Extractor --> Formatter[Formatter / Mapper]
    Formatter --> Cache
    Formatter --> API
    API --> Client
```

## 2. Request Sequence Diagram (Sync-with-timeout mode)

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API (Fastify)
    participant R as Redis Cache
    participant Q as BullMQ Queue
    participant W as Extraction Worker
    participant L as LinkedIn

    C->>A: POST /api/v1/profile { linkedin_url }
    A->>A: Validate URL
    alt invalid URL
        A-->>C: 400 Bad Request
    else valid URL
        A->>R: GET profile:{normalized_url}
        alt cache hit
            R-->>A: cached JSON
            A-->>C: 200 OK (cached)
        else cache miss
            A->>Q: enqueue extraction job
            Q->>W: deliver job
            W->>L: fetch profile data
            alt success
                L-->>W: raw profile data
                W->>W: format to public schema
                W->>R: SET profile:{normalized_url} TTL
                W-->>A: result
                A-->>C: 200 OK
            else failure
                L-->>W: error / timeout
                W-->>A: mapped error
                A-->>C: 4xx / 5xx error response
            end
        end
    end
```

## 3. Deployment Diagram

```mermaid
flowchart TB
    subgraph Internet
        User([Reviewer / Client])
    end

    subgraph Render["Render (Public HTTPS)"]
        Container[Docker Container: Fastify API + BullMQ Worker]
        RedisAddon[(Managed Redis)]
    end

    User -->|HTTPS| Container
    Container <--> RedisAddon
    Container -.->|outbound requests| LinkedIn[(LinkedIn)]
```

## 4. Error Handling Flow

```mermaid
flowchart LR
    Err[Error Occurs] --> Type{Error Type}
    Type -->|Invalid URL| E400[400 Bad Request]
    Type -->|Not Found| E404[404 Not Found]
    Type -->|Private/Restricted| E422[422 Unprocessable]
    Type -->|Rate Limited Upstream| E429[429 Too Many Requests]
    Type -->|Timeout| E504[504 Gateway Timeout]
    Type -->|Unknown| E500[500 Internal Error]
    E400 & E404 & E422 & E429 & E504 & E500 --> Shape[Consistent Error JSON Shape]
```
