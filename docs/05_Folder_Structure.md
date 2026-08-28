# Folder Structure Document
## LinkedIn Profile API — Tross Hiring Challenge

---

## Proposed Repository Layout

```
tross-linkedin-profile-api/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── profile.routes.ts
│   │   │   └── health.routes.ts
│   │   ├── controllers/
│   │   │   └── profile.controller.ts
│   │   └── server.ts
│   │
│   ├── validation/
│   │   └── linkedinUrl.validator.ts
│   │
│   ├── cache/
│   │   ├── redisClient.ts
│   │   └── profileCache.ts
│   │
│   ├── queue/
│   │   ├── queue.ts
│   │   └── worker.ts
│   │
│   ├── extraction/
│   │   ├── ProfileExtractor.interface.ts
│   │   └── implementation/
│   │       └── (your independently-built extraction logic)
│   │
│   ├── formatter/
│   │   └── profileFormatter.ts
│   │
│   ├── errors/
│   │   ├── errorTypes.ts
│   │   └── errorHandler.ts
│   │
│   ├── config/
│   │   └── index.ts
│   │
│   └── types/
│       └── profile.types.ts
│
├── tests/
│   ├── unit/
│   │   ├── validation.test.ts
│   │   ├── formatter.test.ts
│   │   └── errorHandler.test.ts
│   └── integration/
│       └── profile.route.test.ts
│
├── public/
│   └── index.html          (optional minimal demo form)
│
├── docs/
│   └── (these design documents live here in the final repo)
│
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml        (for local Redis + app together)
├── package.json
├── tsconfig.json
└── README.md
```

## Notes on Key Choices

- **`extraction/implementation/` is a dedicated, isolated folder** — this makes it trivial for a reviewer (or you, later) to see exactly where the reverse-engineered logic lives, separate from everything else. It also makes the "known limitations" section of the README easy to scope precisely to this folder.
- **`tests/` split into unit vs integration** — even 4-5 well-chosen tests (validation, formatter edge cases, error mapping) signal more engineering maturity than a large untested codebase.
- **`docs/` folder in the actual repo** — copy these design documents into the repo itself. Reviewers skimming a GitHub repo notice a `docs/` folder before they notice code quality.
- **`docker-compose.yml`** — lets a reviewer run `docker-compose up` and get API + Redis together locally in one command. This is a small touch that meaningfully reduces reviewer friction, which matters when someone is evaluating many submissions.
- **`.env.example`** — shows exactly what configuration is expected without exposing anything real.
