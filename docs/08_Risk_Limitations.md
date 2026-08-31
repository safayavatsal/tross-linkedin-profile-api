# Known Limitations & Risk Notes
## LinkedIn Profile API — Tross Hiring Challenge

*(Bonus document — not explicitly requested, but this is the exact content the challenge asks for under "known limitations" in the README. Drafting it separately first, then folding the finished version into the README, keeps the honesty/rigor of this section from getting rushed at the last minute.)*

---

## Contents

1. [Why This Section Matters](#1-why-this-section-matters)
2. [Data Reliability Limitations](#2-data-reliability-limitations)
3. [Rate & Scale Limitations](#3-rate--scale-limitations)
   - [3a. Credential Lifetime & How This Is Meant to Be Evaluated](#3a-credential-lifetime--how-this-is-meant-to-be-evaluated)
4. [Legal / Terms-of-Service Considerations](#4-legal--terms-of-service-considerations)
5. [Operational Limitations (given 3-day scope)](#5-operational-limitations-given-3-day-scope)
6. [What Would Change for a "Real" Production Version](#6-what-would-change-for-a-real-production-version)
7. [Incident History](#7-incident-history)

## 1. Why This Section Matters

The challenge explicitly asks for "known limitations" in the README. Most candidates either skip this or write one vague sentence. Treating this as a first-class document — written honestly and specifically — is itself a signal of engineering maturity: it shows the ability to reason about a system's failure modes and boundaries, not just its happy path.

## 2. Data Reliability Limitations

- LinkedIn's page structure and internal data shape are not officially documented or contractually stable; the extraction layer may break if LinkedIn changes its frontend implementation.
- Field completeness varies by profile — not all users populate every section (certifications, languages, etc. are frequently blank).
- Some data (e.g., full "About" text, certain contact details) may be visibility-restricted based on the viewer's own LinkedIn connection degree to the target profile.

## 3. Rate & Scale Limitations

- This service is designed for single-profile, on-demand lookups — not bulk/parallel scraping. Caching and internal throttling reflect this design choice.
- Using a single LinkedIn account server-side means the extraction layer has a shared, finite rate budget across all API callers.

### 3a. Credential Lifetime & How This Is Meant to Be Evaluated

- Per the brief ("you may use your own LinkedIn credentials in the backend"), the authenticated extraction path runs on **our** `li_at`/`JSESSIONID`, held only in the deployment's environment variables — never in the repo, never supplied by whoever evaluates the public URL. `li_at` is a long-lived cookie by design (~1 year), not something expected to rotate on every login; but if it does expire, get revoked, or the account gets flagged between submission and whenever this is actually evaluated, the authenticated path fails closed into the no-login `publicExtractor` (see `README.md` "Real (authenticated) extraction setup") rather than breaking the deployed service.
- Anyone who wants to test with a live, guaranteed-fresh session instead of relying on our deployed credentials can clone the repo and supply their own `li_at`/`JSESSIONID` locally — documented in the README setup steps.

## 4. Legal / Terms-of-Service Considerations

- LinkedIn's Terms of Service prohibit automated scraping/access outside their official API and partner program.
- This project is built for the purposes of this hiring challenge as directed by Tross, using the candidate's own account, with deliberate constraints (single-profile lookups, caching, internal throttling) to minimize footprint.
- This is explicitly named here rather than glossed over, because acknowledging a real constraint honestly is more valuable — to both the reviewer and to good engineering practice — than pretending the system has no such exposure.

## 5. Operational Limitations (given 3-day scope)

- Single-region, single-instance deployment — no horizontal scaling implemented (though the architecture supports adding it later; see `03_Architecture.md`, Section 4).
- No persistent database — Redis cache is not intended as durable long-term storage; a cache flush means re-fetching on next request.
- Minimal authentication/authorization on the API itself (not required by the challenge, but would be a next step for a production version).
- Render's free tier spins the instance down after a period of inactivity; the first request afterward pays a cold-start delay before responding. Not fixable without a paid plan.
- The extraction layer has been through three rounds of real-world breakage and fixing since first deploying — LinkedIn's frontend changed shape (a query was retired) and the parsing logic had two bugs of its own (a jumbled multi-position grouping, and a paragraph-text/pagination gap). All three are resolved and verified live as of 2026-08-31. Full blow-by-blow: [§7 Incident History](#7-incident-history).

## 6. What Would Change for a "Real" Production Version

- Multiple extraction workers with independent rate budgets, possibly across multiple accounts (raises its own ToS/ethical considerations, would need explicit sign-off).
- Persistent storage layer for auditability and historical profile snapshots.
- Formal authentication/API-key system for callers.
- Circuit breaker around the extraction layer to detect and respond to upstream structural changes automatically rather than failing silently.

## 7. Incident History

Kept as its own section rather than folded into the bullets above, since each entry is a short story (symptom → root cause → fix), not a one-line fact. Useful for anyone who wants the full reasoning trail, not just the current-state summary.

### A. 2026-08-29 to 2026-08-31 — Three-day extraction block traced to a stale session cookie, not an account ban

LinkedIn's classic Voyager `profileView` REST endpoint returned `410 Gone` against a live authenticated session. Its Dash sibling, and even the plain profile HTML page, then hit a hard edge-level block — an infinite `302` self-redirect, reproducible with plain `curl` (no Playwright, no browser fingerprint involved) — on every attempt across two full days, including after a clean 48h account cool-down. That pointed at a broad, account-wide defense with no engineerable way around it.

It turned out to be neither: the block was tied to that one specific, over-used session cookie (repeated automated-looking traffic against it during two days of testing), not the account itself — a normal, human browser session using the same account worked the entire time. Refreshing `LINKEDIN_LI_AT`/`LINKEDIN_JSESSIONID` from a live, working browser session cleared the block immediately (2026-08-31) — the top-card call, the plain profile page, and every Flight-protocol section call all returned real data on the first try with the new cookie.

**Practical implication:** if the deployed credentials ever start hitting this same infinite-redirect signature again, the fix is a fresh cookie pull (see README "Real (authenticated) extraction setup"), not a longer wait.

### B. 2026-08-31 — The GraphQL "sections" query LinkedIn served before is dead; replaced with their current "Flight protocol" system

Once the session above was working again, `voyagerIdentityDashProfileComponents` (the query this project originally sourced for experience/education/skills/certifications) returned `HTTP 500` straight from LinkedIn's own backend (`java.lang.RuntimeException: A record in the included list does not have a type`) — not a block, a genuinely retired query. Checking the live profile page's own JS bundles confirmed it: none of them reference that query anymore.

LinkedIn has migrated this entire part of the profile page to a React Server Components **"Flight protocol"** rendering system instead (`src/extraction/implementation/linkedinFlightProtocol.ts`). Content in a Flight response isn't named JSON fields — it's plain rendered text recovered by pattern-matching a handful of recurring component shapes (see that module's docstring). The rewrite also correctly attributes LinkedIn's multi-position (promotions-at-one-company) grouping to the right company, rather than jumbling title/company/duration across entries — LinkedIn groups those under a single header (title = company, subtitle = "Employment type · total duration") followed by title-only position entries, and the parser now detects that header shape by its employment-type vocabulary rather than by structural position.

### C. 2026-08-31 (second pass, same day) — About/description text came back `null`, and long experience histories were silently truncated

A real user report against a densely-filled profile (19 positions, paragraph-length descriptions throughout) surfaced two further bugs in the same Flight-protocol layer, both fixed in the same session:

1. **Multi-paragraph text came back `null`.** LinkedIn renders a long text block (About, or a job/education description) as a nested array of one segment per line, not a single string — the parser only handled the single-string case, so About and every description came back `null` on any profile with real paragraph breaks (i.e. most real profiles). Fixed by reconstructing the text recursively from the nested segment shape.
2. **Experience lists were truncated.** The per-section response used above is itself a capped *preview* — every section carries a `paginationNeeded:true` flag and a "See all" link to `/in/{id}/details/{section}/` — and on this profile it silently dropped entries past the first page (9 of 15 real positions came back). Fixed: experience now additionally fetches that details page for the complete list. That page also renders full site chrome (global nav, a "who viewed your profile" rail) interleaved with the real list, so its own description text isn't positionally trustworthy — descriptions are still sourced from the original, clean preview response, matched onto the full list by (title, dates) rather than by position.

Education/skills/certifications/languages didn't hit the same pagination cap on the account this was verified against and still come from the preview alone; the details-page fetch above is the pattern to extend if a future profile needs the same treatment for one of those sections.
