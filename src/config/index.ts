import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",

  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  profileCacheTtlSeconds: num("PROFILE_CACHE_TTL_SECONDS", 86400),

  extractionTimeoutMs: num("EXTRACTION_TIMEOUT_MS", 15000),
  extractionMaxAttempts: num("EXTRACTION_MAX_ATTEMPTS", 3),
  extractionMaxCallsPerMinute: num("EXTRACTION_MAX_CALLS_PER_MINUTE", 10),

  rateLimitMax: num("RATE_LIMIT_MAX", 60),
  rateLimitWindowMs: num("RATE_LIMIT_WINDOW_MS", 60000),

  // Real extraction (Voyager API), see src/extraction/implementation/linkedinExtractor.ts.
  // Both unset -> worker falls back to the mock extractor.
  linkedinLiAt: process.env.LINKEDIN_LI_AT || null,
  linkedinJsessionid: process.env.LINKEDIN_JSESSIONID || null,
} as const;
