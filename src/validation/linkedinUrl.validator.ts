import { InvalidUrlError } from "../errors/errorTypes.js";

const HOSTNAME_RE = /^([a-z]{2}\.)?(www\.)?linkedin\.com$/;
const PATH_RE = /^\/in\/([a-zA-Z0-9-]+)\/?$/;

export function normalizeLinkedInUrl(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new InvalidUrlError();
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidUrlError();
  }

  if (!HOSTNAME_RE.test(url.hostname.toLowerCase())) {
    throw new InvalidUrlError();
  }

  const match = PATH_RE.exec(url.pathname);
  if (!match) {
    throw new InvalidUrlError();
  }

  return `https://${url.hostname.toLowerCase()}/in/${match[1]}`;
}
