# Extraction Layer Deep Dive
## LinkedIn Profile API — Tross Hiring Challenge

Four implementations behind the same `ProfileExtractor` interface (`src/extraction/ProfileExtractor.interface.ts`). `src/queue/worker.ts` chooses between the two *deployed* ones per request, with automatic fallback — there is no mock/fake data anywhere in the live request path. Summary table: [README.md § Extraction layer](../README.md#extraction-layer).

## `linkedinExtractor.ts` — confirmed live-working end to end against a real account (2026-08-31)

Two calls into two different LinkedIn systems, both real and unofficial/reverse-engineered:

- **Top card** (name, headline, location, photo) — LinkedIn's internal Voyager **"Dash"** API (`voyagerIdentityDashProfiles`, `decorationId=...TopCardComplete-138`). The response is `{data, included}`; the profile record lives in `included`, keyed by `$recipeTypes` naming `TopCardComplete`. Location is a second-hop lookup through a separate geo entity elsewhere in `included`.
- **Deep sections** (about, experience, education, skills, certifications, languages) — a different system: LinkedIn's React Server Components **"Flight protocol"** rendering pipeline (`linkedinFlightProtocol.ts`), fetched via `POST /flagship-web/rsc-action/actions/component`. Content isn't named JSON fields — it's plain rendered text recovered by pattern-matching a handful of recurring component shapes (see that module's docstring). Each section is fetched and fails independently: a bad parse or a `500` on one section just omits that field, never fails the whole request.
  - **Multi-position grouping:** LinkedIn groups promotions at one company under a single header (title = company name, subtitle = "Employment type · total duration"), followed by title-only position entries. `parseExperience` (`linkedinSectionParsers.ts`) detects that header shape by its employment-type vocabulary and carries the company forward onto each position beneath it.
  - **Multi-paragraph text:** About and job/education descriptions render as a nested array of line segments, not one string — reconstructed by recursively joining the segments.
  - **Experience pagination:** the section response above is a capped *preview*; on a profile with enough history it drops entries past the first page. Experience additionally fetches LinkedIn's own "see all" details page for the complete list, and still sources descriptions from the clean preview response (the details page interleaves full site chrome into the list, so its own description positions aren't trustworthy).

  Both calls are gated by a self-imposed pacing module (`linkedinPacing.ts`: a minimum interval between calls, plus a cooldown after any detected block) — disciplined pacing, not evasion tooling, since LinkedIn's blocking is account-level and behavior-based rather than fingerprint-based.

  The full story behind each of the three bullets above — what broke, how it was diagnosed, how it was fixed — is in [`08_Risk_Limitations.md` §7 Incident History](08_Risk_Limitations.md#7-incident-history).

## `publicExtractor.ts`

No login needed. Real data, but much less of it: name, headline, current company/location, about, photo — experience/education/skills/certifications/languages aren't exposed to anonymous visitors, so those keys are omitted (same null-vs-omission convention as everywhere else).

## `playwrightExtractor.ts` — why it isn't deployed

First and foremost, it isn't allowed to be: the challenge's official clarification email states the solution must be "a purely reverse-engineered solution that directly hits LinkedIn endpoints and does not use a browser" (see [`00_Original_Challenge.md`](00_Original_Challenge.md)). It was built and kept strictly as a **local-only diagnostic** — it's what confirmed an early block was happening at LinkedIn's edge/CDN layer rather than being specific to the Voyager API shape (see the incident history linked above), not a candidate for the submitted solution. It also wouldn't be practical to deploy anyway: headless Chromium needs ~300–400MB RAM on top of the Node process, risking an OOM crash on Render's free-tier instance (512MB total). Run it with `npm run extract:local -- <profile-url>` (needs `npx playwright install chromium` once).

## Real (authenticated) extraction setup

1. Log into linkedin.com in your browser.
2. Open devtools → Application/Storage → Cookies → `https://www.linkedin.com`.
3. Copy the values of the `li_at` and `JSESSIONID` cookies (the latter includes surrounding quotes in the browser — set the env var **without** the quotes).
4. Set `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` in `.env` (or Render's environment variables). `docker-compose up` reads the same repo-root `.env` automatically — just restart the stack after editing it.
5. Leave both unset (or if the authenticated call fails) and the app still returns real, if partial, data via `publicExtractor` — no setup required, and no hard failure either way.
6. `npm run probe:linkedin -- <profile-url>` — diagnostic-only, local, not part of the request path. Fetches the top-card call plus every Flight-protocol section (`scripts/probeLinkedinDashSections.ts`) and prints each raw response — useful for re-checking `linkedinFlightProtocol.ts`'s parsers against a real response shape whenever LinkedIn's next frontend rebuild rotates the componentId names or CSS-in-JS class markers this parsing keys off of.

## Credential lifetime and how this is meant to be evaluated

The challenge brief explicitly says *"you may use your own LinkedIn credentials in the backend"* — these credentials live only in the deployment's environment variables (Render's, in this submission), never in the evaluator's hands. Whoever tests the live public URL just POSTs a profile URL; they never need to supply `li_at`/`JSESSIONID` themselves. `li_at` is long-lived by design (LinkedIn sets it to persist roughly a year), but if it expires, gets revoked, or the account gets flagged before this is evaluated, the authenticated path fails closed into `publicExtractor` (step 5 above) rather than breaking the deployed service. Anyone who prefers to test with their *own* live session can clone the repo and follow steps 1–4 with their own account. Full detail: [`08_Risk_Limitations.md` §3a](08_Risk_Limitations.md#3a-credential-lifetime--how-this-is-meant-to-be-evaluated).
