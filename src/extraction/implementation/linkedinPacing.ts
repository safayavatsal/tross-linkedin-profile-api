// Self-imposed request pacing for outbound LinkedIn calls, per the internal
// investigation into why linkedinExtractor was getting escalating blocks:
// Prior research indicated LinkedIn's blocking as account-level and
// behavioral (request volume/timing), not fingerprint-based — so the fix is
// disciplined pacing, not evasion. This is a process-local floor to stop this
// server hammering LinkedIn during a bad patch; it is deliberately much shorter
// than the 24-48h account-level cool-down we observed by hand during
// development (a hard-coded day-long block would make the deployed demo look
// permanently broken to anyone testing it shortly after a single hiccup).
// ponytail: single in-memory gate, good enough for a single-instance worker;
// upgrade to a Redis-backed gate if this ever runs as multiple instances.
const MIN_INTERVAL_MS = 10_000;
const BLOCK_COOLDOWN_MS = 15 * 60_000;

let nextAllowedAt = 0;

export function msUntilAllowed(): number {
  return Math.max(0, nextAllowedAt - Date.now());
}

export function recordAttempt(): void {
  nextAllowedAt = Math.max(nextAllowedAt, Date.now() + MIN_INTERVAL_MS);
}

export function recordBlock(): void {
  nextAllowedAt = Date.now() + BLOCK_COOLDOWN_MS;
}
