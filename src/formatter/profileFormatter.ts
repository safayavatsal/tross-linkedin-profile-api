import type { PublicProfile, RawProfileData } from "../types/profile.types.js";

export function formatProfile(raw: RawProfileData): PublicProfile {
  const profile: PublicProfile = {
    name: raw.name,
    headline: raw.headline ?? null,
    location: raw.location ?? null,
    about: raw.about ?? null,
  };

  if (raw.experience !== undefined) {
    profile.experience = raw.experience.map((entry) => ({
      title: entry.title,
      company: entry.company,
      duration: entry.duration,
      location: entry.location ?? null,
      description: entry.description ?? null,
    }));
  }

  if (raw.education !== undefined) {
    profile.education = raw.education.map((entry) => ({
      school: entry.school,
      degree: entry.degree ?? null,
      duration: entry.duration ?? null,
    }));
  }

  if (raw.skills !== undefined) {
    profile.skills = raw.skills;
  }

  if (raw.certifications !== undefined) {
    profile.certifications = raw.certifications.map((entry) => ({
      name: entry.name,
      issuer: entry.issuer ?? null,
      date: entry.date ?? null,
    }));
  }

  if (raw.languages !== undefined) {
    profile.languages = raw.languages;
  }

  if (raw.profilePhotoUrl !== undefined || raw.bannerUrl !== undefined) {
    profile.images = {
      profile_photo: raw.profilePhotoUrl ?? null,
      banner: raw.bannerUrl ?? null,
    };
  }

  return profile;
}
