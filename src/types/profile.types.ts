// Shared contract types. Source of truth: docs/07_API_Contract.md and docs/02_LLD.md.

export interface RawExperienceEntry {
  title: string;
  company: string;
  duration: string;
  location: string | null;
  description: string | null;
}

export interface RawEducationEntry {
  school: string;
  degree: string | null;
  duration: string | null;
}

export interface RawCertificationEntry {
  name: string;
  issuer: string | null;
  date: string | null;
}

// What ProfileExtractor.fetch() returns — the raw, ungroomed shape coming out
// of extraction, before the Formatter maps it onto the public API schema.
export interface RawProfileData {
  name: string;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience?: RawExperienceEntry[];
  education?: RawEducationEntry[];
  skills?: string[];
  certifications?: RawCertificationEntry[];
  languages?: string[];
  profilePhotoUrl?: string | null;
  bannerUrl?: string | null;
}

// Public response schema — docs/07_API_Contract.md §1.
// Missing-field convention: a field that exists but is empty -> null / [].
// A section LinkedIn doesn't expose at all for this profile -> key omitted.
export interface PublicProfileImages {
  profile_photo: string | null;
  banner: string | null;
}

export interface PublicProfile {
  name: string;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience?: {
    title: string;
    company: string;
    duration: string;
    location: string | null;
    description: string | null;
  }[];
  education?: {
    school: string;
    degree: string | null;
    duration: string | null;
  }[];
  skills?: string[];
  certifications?: {
    name: string;
    issuer: string | null;
    date: string | null;
  }[];
  languages?: string[];
  images?: PublicProfileImages;
}

export type ProfileSource = "cache" | "live";

export interface ProfileSuccessResponse {
  status: "success";
  data: PublicProfile;
  meta: {
    source: ProfileSource;
    fetched_at: string;
  };
}
