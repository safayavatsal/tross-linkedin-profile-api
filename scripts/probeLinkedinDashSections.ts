// Diagnostic-only, local-run tool for Wayfinder ticket T7 — NOT part of the deployed
// extraction path. Fetches the top-card (the one endpoint linkedinExtractor.ts actually
// ships) plus the experience/education/skills/certifications/languages/bio candidate
// endpoints from T2's research, and prints each raw JSON response.
//
// Why raw dump instead of parsed fields: the *endpoints* are sourced from StaffSpy's
// real code, but their *response shape* (which key holds the job title vs. the company
// name, etc.) is unconfirmed until we see one. This lets a single live run capture that
// evidence for every section at once, so a follow-up ticket can write an accurate parser
// instead of guessing. Respects the same pacing gate as linkedinExtractor.ts.
//
// Usage: npm run probe:linkedin -- https://www.linkedin.com/in/<slug>
import { config } from "../src/config/index.js";
import { isRedirectBlock } from "../src/extraction/implementation/redirectBlock.js";
import { msUntilAllowed, recordAttempt, recordBlock } from "../src/extraction/implementation/linkedinPacing.js";
import {
  topCardUrl,
  profileComponentsBySectionTypeUrl,
  profileTabInitialCardsUrl,
  findProfileUrnId,
  SECTION_TYPES,
} from "../src/extraction/implementation/linkedinDashEndpoints.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run probe:linkedin -- <linkedin-profile-url>");
  process.exit(1);
}
if (!config.linkedinLiAt || !config.linkedinJsessionid) {
  console.error("Set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID first.");
  process.exit(1);
}

function headers(graphql: boolean): Record<string, string> {
  return {
    cookie: `li_at=${config.linkedinLiAt}; JSESSIONID="${config.linkedinJsessionid}"`,
    "csrf-token": config.linkedinJsessionid!,
    "x-restli-protocol-version": "2.0.0",
    ...(graphql ? { "x-li-graphql-pegasus-client": "true" } : {}),
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
}

async function probe(label: string, target: string, graphql: boolean): Promise<unknown> {
  const wait = msUntilAllowed();
  if (wait > 0) {
    console.log(`\n=== ${label}: skipped, self-imposed pacing (wait ${Math.ceil(wait / 1000)}s) ===`);
    return null;
  }
  recordAttempt();
  try {
    const res = await fetch(target, { headers: headers(graphql) });
    if (res.status === 401 || res.status === 403 || res.status === 999) {
      recordBlock();
      console.log(`\n=== ${label}: blocked (HTTP ${res.status}) ===`);
      return null;
    }
    if (!res.ok) {
      console.log(`\n=== ${label}: HTTP ${res.status} ===`);
      return null;
    }
    const body = await res.json();
    console.log(`\n=== ${label} (HTTP ${res.status}) ===`);
    console.log(JSON.stringify(body, null, 2).slice(0, 4000));
    return body;
  } catch (err) {
    if (isRedirectBlock(err)) {
      recordBlock();
      console.log(`\n=== ${label}: blocked (infinite redirect) ===`);
    } else {
      console.log(`\n=== ${label}: network error — ${(err as Error).message} ===`);
    }
    return null;
  }
}

const publicIdentifier = new URL(url).pathname.replace(/^\/in\//, "").replace(/\/$/, "");

const topCard = await probe("top-card", topCardUrl(publicIdentifier), false);
if (!topCard) {
  console.error("\nTop-card failed — stopping (can't derive profileUrn for the section calls).");
  process.exit(1);
}

const profileUrnId = findProfileUrnId(topCard);
if (!profileUrnId) {
  console.error("\nNo urn:li:fsd_profile:... found anywhere in the top-card response — stopping.");
  process.exit(1);
}
console.log(`\nprofileUrnId = ${profileUrnId}`);

for (const sectionType of SECTION_TYPES) {
  await probe(`section: ${sectionType}`, profileComponentsBySectionTypeUrl(profileUrnId, sectionType), true);
}
await probe("bio / initial cards", profileTabInitialCardsUrl(profileUrnId), true);
