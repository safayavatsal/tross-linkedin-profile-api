// LinkedIn's edge layer soft-blocks automated traffic with an infinite self-redirect
// (confirmed via curl and Playwright, see README "Extraction layer"). Node's global
// fetch() surfaces that as a generic "fetch failed" with cause "redirect count
// exceeded" rather than a normal HTTP response — detect it so callers can map it to
// the same UpstreamRateLimitedError as every other block signal, instead of a
// meaningless 500.
export function isRedirectBlock(err: unknown): boolean {
  return err instanceof Error && err.message === "fetch failed" && (err.cause as Error | undefined)?.message === "redirect count exceeded";
}
