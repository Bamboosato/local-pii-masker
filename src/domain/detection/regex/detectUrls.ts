import type { DetectionCandidate } from "../mergeCandidates";
import { createRegexCandidate, uniqueCandidates } from "./common";

const URL_PATTERN =
  /https?:\/\/[A-Za-z0-9._~:/?@!$&*+,;=%#-]+/giu;

export function detectUrls(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(URL_PATTERN)) {
    const value = match[0];
    const candidate = createRegexCandidate({
      category: "OTHER",
      sourceText,
      start: match.index,
      end: match.index + value.length,
    });

    if (candidate && isValidHttpUrl(candidate.originalText)) {
      candidates.push(candidate);
    }
  }

  return uniqueCandidates(candidates);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 &&
      (parsed.hostname === "localhost" || parsed.hostname.includes("."))
    );
  } catch {
    return false;
  }
}
