# Deploying to Render

## 1. Create the Web Service

1. In the Render dashboard, click **New > Web Service**.
2. Connect this GitHub repo.
3. Environment: select **Docker**. Render auto-detects the `Dockerfile` at the repo root — no build/start command override needed.
4. Pick a region and instance size, then create the service.

## 2. Provision Redis

1. Create a Render **Key Value** instance (Redis-compatible) in the **same region** as the web service, so traffic stays on the internal network.
2. Once provisioned, copy its **internal connection string** (starts with `redis://` and only resolves from inside Render's network — do not use the external URL for `REDIS_URL`).

## 3. Environment variables

Set these in the Web Service's **Environment** tab:

| Variable | Required | Notes |
|---|---|---|
| `REDIS_URL` | Yes | The Key Value instance's internal connection string from step 2. |
| `PORT` | No | Render injects its own `PORT` env var and expects the service to listen on it. This app already reads `process.env.PORT` via `src/config/index.ts`, so no code change is needed — just don't set `PORT` to a fixed value in Render's settings that conflicts with what Render assigns. |
| `HOST` | No | Defaults to `0.0.0.0`, which is required for Render to route traffic to the container. Leave unset. |
| `LOG_LEVEL` | No | Defaults to `info`. |
| `PROFILE_CACHE_TTL_SECONDS` | No | Defaults to `86400` (24h). |
| `EXTRACTION_TIMEOUT_MS` | No | Defaults to `15000`. |
| `EXTRACTION_MAX_ATTEMPTS` | No | Defaults to `3`. |
| `EXTRACTION_MAX_CALLS_PER_MINUTE` | No | Defaults to `10`. |
| `RATE_LIMIT_MAX` | No | Defaults to `60`. |
| `RATE_LIMIT_WINDOW_MS` | No | Defaults to `60000`. |
| `LINKEDIN_LI_AT` | No | Your LinkedIn session cookie. Unset -> mock extractor. See README "Real extraction setup". |
| `LINKEDIN_JSESSIONID` | No | Your LinkedIn CSRF/session cookie, paired with `LINKEDIN_LI_AT`. |

All optional variables have sensible defaults baked into `src/config/index.ts` and only need to be set if you want to override them.

## 4. Build & start commands

Render runs the `Dockerfile`'s `CMD` (`node dist/api/server.js`) automatically — no override needed.

If instead deploying via Render's native Node runtime (no Docker), use:
- Build command: `npm ci && npm run build`
- Start command: `npm start`

## 5. HTTPS

Render terminates TLS at the platform edge automatically. No certificate or TLS configuration is needed in the app.

## 6. Secrets

Never commit `.env` — only `.env.example` is tracked in the repo. Set real values only in the Render dashboard's environment variables.
