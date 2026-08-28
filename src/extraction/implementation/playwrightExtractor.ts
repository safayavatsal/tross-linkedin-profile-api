import { chromium } from "playwright";
import { config } from "../../config/index.js";
import {
  ProfilePrivateOrUnreachableError,
  UpstreamRateLimitedError,
  UnknownExtractionError,
} from "../../errors/errorTypes.js";
import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawExperienceEntry, RawEducationEntry, RawProfileData } from "../../types/profile.types.js";

// Local-only workaround for the SDUI/Flight-stream wall documented in the README
// (linkedinExtractor gets 410, SDUI responses aren't parseable JSON). A real
// logged-in browser doesn't care about the wire format — it just renders the
// page, same as when you view it yourself. Not wired into worker.ts/Dockerfile:
// headless Chromium needs ~300-400MB RAM, which risks OOM-crashing the Render
// free tier. Run via `npm run extract:local -- <url>`. See README "Extraction
// layer" for details and known fragility (LinkedIn's class names are hashed
// and churn, so these selectors can break without notice).
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function textOrNull(locator: ReturnType<import("playwright").Page["locator"]>): Promise<string | null> {
  try {
    const text = (await locator.first().innerText({ timeout: 3000 })).trim();
    return text || null;
  } catch {
    return null;
  }
}

async function sectionItems(page: import("playwright").Page, headingText: string): Promise<string[]> {
  try {
    const section = page.locator("section", { has: page.getByRole("heading", { name: headingText }) }).first();
    const items = await section.locator("li").allInnerTexts();
    return items.map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseExperience(lines: string[]): RawExperienceEntry[] {
  // Each <li> dumps its whole card as one innerText blob, newline-separated
  // (title / company / duration / location, in that order on LinkedIn's layout).
  return lines.map((block) => {
    const parts = block.split("\n").map((s) => s.trim()).filter(Boolean);
    return {
      title: parts[0] ?? "",
      company: parts[1] ?? "",
      duration: parts[2] ?? "",
      location: parts[3] ?? null,
      description: parts.slice(4).join(" ") || null,
    };
  });
}

function parseEducation(lines: string[]): RawEducationEntry[] {
  return lines.map((block) => {
    const parts = block.split("\n").map((s) => s.trim()).filter(Boolean);
    return {
      school: parts[0] ?? "",
      degree: parts[1] ?? null,
      duration: parts[2] ?? null,
    };
  });
}

export const playwrightExtractor: ProfileExtractor = {
  async fetch(normalizedUrl: string): Promise<RawProfileData> {
    if (!config.linkedinLiAt || !config.linkedinJsessionid) {
      throw new UnknownExtractionError("Real extraction not configured: set LINKEDIN_LI_AT and LINKEDIN_JSESSIONID");
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 1600 } });
      await context.addCookies([
        { name: "li_at", value: config.linkedinLiAt, domain: ".linkedin.com", path: "/" },
        { name: "JSESSIONID", value: `"${config.linkedinJsessionid}"`, domain: ".linkedin.com", path: "/" },
      ]);

      const page = await context.newPage();
      let res;
      try {
        res = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (err) {
        // ERR_TOO_MANY_REDIRECTS is LinkedIn's confirmed edge-level block for this
        // request pattern (see README "Extraction layer") — same shape as a 429.
        if ((err as Error).message.includes("ERR_TOO_MANY_REDIRECTS")) {
          throw new UpstreamRateLimitedError("LinkedIn blocked the request with an infinite redirect (edge-level automated-traffic block)");
        }
        throw new UnknownExtractionError(`Navigation failed: ${(err as Error).message.split("\n")[0]}`);
      }
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      const finalUrl = page.url();
      if (finalUrl.includes("/login") || finalUrl.includes("/checkpoint") || finalUrl.includes("authwall")) {
        throw new UpstreamRateLimitedError("LinkedIn redirected to a login/checkpoint page — session cookies expired or flagged");
      }
      if (res && res.status() === 404) throw new ProfilePrivateOrUnreachableError();

      const name = await textOrNull(page.locator("h1"));
      if (!name) throw new ProfilePrivateOrUnreachableError();

      const headline = await textOrNull(page.locator(".text-body-medium").first());
      const location = await textOrNull(page.locator(".text-body-small.inline").first());
      const about = await textOrNull(
        page.locator("section", { has: page.getByRole("heading", { name: "About" }) }).first().locator("span"),
      );

      const experience = parseExperience(await sectionItems(page, "Experience"));
      const education = parseEducation(await sectionItems(page, "Education"));

      return {
        name,
        headline,
        location,
        about,
        experience: experience.length ? experience : undefined,
        education: education.length ? education : undefined,
      };
    } finally {
      await browser.close();
    }
  },
};
