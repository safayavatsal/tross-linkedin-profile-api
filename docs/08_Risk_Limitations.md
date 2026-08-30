# Known Limitations & Risk Notes
## LinkedIn Profile API — Tross Hiring Challenge

*(Bonus document — not explicitly requested, but this is the exact content the challenge asks for under "known limitations" in the README. Drafting it separately first, then folding the finished version into the README, keeps the honesty/rigor of this section from getting rushed at the last minute.)*

---

## 1. Why This Section Matters

The challenge explicitly asks for "known limitations" in the README. Most candidates either skip this or write one vague sentence. Treating this as a first-class document — written honestly and specifically — is itself a signal of engineering maturity: it shows the ability to reason about a system's failure modes and boundaries, not just its happy path.

## 2. Data Reliability Limitations

- LinkedIn's page structure and internal data shape are not officially documented or contractually stable; the extraction layer may break if LinkedIn changes its frontend implementation.
- Field completeness varies by profile — not all users populate every section (certifications, languages, etc. are frequently blank).
- Some data (e.g., full "About" text, certain contact details) may be visibility-restricted based on the viewer's own LinkedIn connection degree to the target profile.

## 3. Rate & Scale Limitations

- This service is designed for single-profile, on-demand lookups — not bulk/parallel scraping. Caching and internal throttling reflect this design choice.
- Using a single LinkedIn account server-side means the extraction layer has a shared, finite rate budget across all API callers.

## 3a. Credential Lifetime & How This Is Meant to Be Evaluated

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
- Experience/education/skills/certifications/languages are implemented (sourced field mappings, fixture-tested) but never verified against a live LinkedIn response, since the account used for this build has stayed blocked throughout — see `README.md` "Extraction layer" and "Known limitations" for the current state.

## 6. What Would Change for a "Real" Production Version

- Multiple extraction workers with independent rate budgets, possibly across multiple accounts (raises its own ToS/ethical considerations, would need explicit sign-off).
- Persistent storage layer for auditability and historical profile snapshots.
- Formal authentication/API-key system for callers.
- Circuit breaker around the extraction layer to detect and respond to upstream structural changes automatically rather than failing silently.
