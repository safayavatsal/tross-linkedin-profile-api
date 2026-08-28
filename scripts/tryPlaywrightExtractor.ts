// Manual local smoke test for playwrightExtractor — not part of the build/deploy.
// Usage: npm run extract:local -- https://www.linkedin.com/in/<slug>
import { playwrightExtractor } from "../src/extraction/implementation/playwrightExtractor.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run extract:local -- <linkedin-profile-url>");
  process.exit(1);
}

const data = await playwrightExtractor.fetch(url);
console.log(JSON.stringify(data, null, 2));
