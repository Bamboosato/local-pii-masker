import type { DetectionCandidate } from "../mergeCandidates";
import {
  ASCII_OR_FULLWIDTH_ALPHA_CHARS,
  DIGIT_CHARS,
  HYPHEN_CHARS,
  createRegexCandidate,
  uniqueCandidates,
} from "./common";

const POSTAL_CODE_PATTERN = new RegExp(
  `(^|[^${DIGIT_CHARS}${ASCII_OR_FULLWIDTH_ALPHA_CHARS}${HYPHEN_CHARS}])` +
    `((?:〒\\s*)?[${DIGIT_CHARS}]{3}[${HYPHEN_CHARS}][${DIGIT_CHARS}]{4})` +
    `(?=$|[^${DIGIT_CHARS}${ASCII_OR_FULLWIDTH_ALPHA_CHARS}${HYPHEN_CHARS}])`,
  "g",
);

export function detectPostalCodes(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(POSTAL_CODE_PATTERN)) {
    const prefix = match[1] ?? "";
    const value = match[2];

    if (value === undefined) {
      continue;
    }

    const start = match.index + prefix.length;
    const candidate = createRegexCandidate({
      category: "POSTAL_CODE",
      sourceText,
      start,
      end: start + value.length,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return uniqueCandidates(candidates);
}
