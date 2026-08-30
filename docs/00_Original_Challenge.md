# Tross — Next Round: Hiring Challenge

## LinkedIn Profile API

**Challenge:** Reverse engineer LinkedIn APIs and build a hosted API that accepts a LinkedIn profile URL and returns most of the information available on the profile page as structured JSON.

## Requirements

- Deploy the API publicly over HTTPS.
- Accept a LinkedIn profile URL as input.
- Return details such as name, headline, location, about, experience, education, skills, certifications, languages, and profile images when available.
- You may use your own LinkedIn credentials in the backend.
- Submit a public GitHub repository containing the complete source code.
- Include a README with setup instructions, API documentation, your approach, and known limitations.
- Keep all credentials and secrets out of the repository.

## Example

[https://phantombuster.com/automations/linkedin/5589386912058181/linkedin-profile-scraper](https://phantombuster.com/automations/linkedin/5589386912058181/linkedin-profile-scraper)

## Response Schema

The response schema is yours to design.

## Submission

| | |
|---|---|
| **Submit here** | [https://tally.so/r/KYK6qg](https://tally.so/r/KYK6qg) |
| **Deadline** | 31 August |

## Official clarification (email from the Tross Careers Team)

> A quick clarification on the assignment based on a few questions we've received from candidates.
>
> For the LinkedIn part of the assignment, we are looking for a purely reverse-engineered solution
> that directly hits LinkedIn endpoints and does not use a browser.
>
> If you've already started, please make sure your approach follows this requirement. And if you
> haven't started yet, this should help clarify the direction before you begin.

**This is a hard requirement, not a suggestion — treated as such throughout this build.** The
deployed/live extraction path (`linkedinExtractor.ts`, `publicExtractor.ts`) only ever makes direct
HTTP calls to LinkedIn's own endpoints (the Voyager "Dash" API and the public JSON-LD embed
respectively) — no browser automation anywhere in the live request path. `playwrightExtractor.ts`
(headless Chromium) exists only as a **local-only, never-deployed** diagnostic tool used to confirm
that LinkedIn's block was happening at the edge/CDN layer rather than being a Voyager-API-specific
issue (see `README.md` "Extraction layer" and T10)
— it is not part of, and was never intended to be part of, the submitted solution.
