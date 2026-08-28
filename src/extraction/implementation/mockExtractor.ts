// =============================================================
// STUB IMPLEMENTATION — DO NOT USE AS FINAL EXTRACTION LOGIC.
// The real extraction implementation is written independently
// by the candidate outside of this automated build process.
// This stub exists only so the rest of the system (API, cache,
// queue, error handling, tests, deployment) is fully runnable
// and demonstrable end-to-end without it.
// =============================================================

import type { ProfileExtractor } from "../ProfileExtractor.interface.js";
import type { RawProfileData } from "../../types/profile.types.js";

function nameFromUrl(normalizedUrl: string): string {
  const match = normalizedUrl.match(/\/in\/([^/?]+)/);
  const slug = match ? match[1] : "unknown-profile";
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const mockExtractor: ProfileExtractor = {
  async fetch(normalizedUrl: string): Promise<RawProfileData> {
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));

    const name = nameFromUrl(normalizedUrl);

    return {
      name,
      headline: "Senior Software Engineer at Example Co.",
      location: "Bengaluru, India",
      about:
        "Experienced software engineer with a focus on distributed systems and developer tooling. Passionate about building reliable, scalable products and mentoring engineers.",
      experience: [
        {
          title: "Senior Software Engineer",
          company: "Example Co.",
          duration: "2022 - Present",
          location: "Bengaluru, India",
          description: "Led development of core platform services and mentored junior engineers.",
        },
        {
          title: "Software Engineer",
          company: "Prior Co.",
          duration: "2019 - 2022",
          location: "Pune, India",
          description: "Built and maintained backend APIs serving millions of requests per day.",
        },
      ],
      education: [
        {
          school: "Example University",
          degree: "B.Tech, Computer Science",
          duration: "2016 - 2020",
        },
      ],
      skills: ["TypeScript", "Node.js", "System Design", "PostgreSQL", "Redis"],
      certifications: [
        {
          name: "Example Certification",
          issuer: "Example Org",
          date: "2023",
        },
      ],
      languages: ["English", "Hindi"],
      profilePhotoUrl: "https://media.licdn.com/dms/image/mock/profile.jpg",
      bannerUrl: null,
    };
  },
};

// Minimal profile with only the required scalar fields — exercises the
// formatter's omit-if-undefined convention for the optional sections.
export const emptyProfileExtractorFixture: RawProfileData = {
  name: "Minimal Profile",
  headline: null,
  location: null,
  about: null,
};
