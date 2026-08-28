# --- Stage 1: build ---
FROM node:20-alpine AS builder
WORKDIR /app

# playwright is a devDependency used only by scripts/tryPlaywrightExtractor.ts
# (local-only tool, never imported by the deployed server/worker) — skip its
# ~300MB Chromium download here, we only need the package for `tsc` to type-check it.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public ./public

EXPOSE 3000
CMD ["node", "dist/api/server.js"]
