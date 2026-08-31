// Diagnostic-only, local-run tool for internal ticket T12 — NOT part of the deployed
// extraction path. Fetches the top-card (Voyager Dash) and every profile section (Flight
// protocol) for a real profile and prints each raw response, for debugging when LinkedIn's
// next frontend rebuild inevitably rotates the Flight componentId naming or CSS-in-JS
// class markers this project's parsers key off of (see linkedinFlightProtocol.ts).
//
// Usage: npm run probe:linkedin -- https://www.linkedin.com/in/<slug>
import { config } from "../src/config/index.js";
import { isRedirectBlock } from "../src/extraction/implementation/redirectBlock.js";
import { msUntilAllowed, recordAttempt, recordBlock } from "../src/extraction/implementation/linkedinPacing.js";
import { topCardUrl } from "../src/extraction/implementation/linkedinDashEndpoints.js";
import { fetchFlightComponent, FLIGHT_COMPONENT_IDS, type FlightSection } from "../src/extraction/implementation/linkedinFlightProtocol.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run probe:linkedin -- <linkedin-profile-url>");
  process.exit(1);
}
if (!config.linkedinLiAt || !config.linkedinJsessionid) {
  console.error("Set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID first.");
  process.exit(1);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const publicIdentifier = new URL(url).pathname.replace(/^\/in\//, "").replace(/\/$/, "");

async function paced(label: string, run: () => Promise<unknown>): Promise<void> {
  const wait = msUntilAllowed();
  if (wait > 0) {
    console.log(`\n=== ${label}: skipped, self-imposed pacing (wait ${Math.ceil(wait / 1000)}s) ===`);
    return;
  }
  recordAttempt();
  try {
    const body = await run();
    console.log(`\n=== ${label}: OK ===`);
    console.log(typeof body === "string" ? body.slice(0, 3000) : JSON.stringify(body, null, 2).slice(0, 3000));
  } catch (err) {
    if (isRedirectBlock(err)) {
      recordBlock();
      console.log(`\n=== ${label}: blocked (infinite redirect) ===`);
    } else {
      console.log(`\n=== ${label}: ${(err as Error).message} ===`);
    }
  }
}

await paced("top-card", async () => {
  const res = await fetch(topCardUrl(publicIdentifier), {
    headers: {
      cookie: `li_at=${config.linkedinLiAt}; JSESSIONID="${config.linkedinJsessionid}"`,
      "csrf-token": config.linkedinJsessionid as string,
      "x-restli-protocol-version": "2.0.0",
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});

for (const section of Object.keys(FLIGHT_COMPONENT_IDS) as FlightSection[]) {
  await sleep(1500); // avoid firing every section call back-to-back with zero gap
  await paced(`section: ${section}`, () => fetchFlightComponent(publicIdentifier, section));
}
