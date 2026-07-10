import type { DetectionCandidate } from "../mergeCandidates";
import {
  ASCII_OR_FULLWIDTH_ALPHA_CHARS,
  DIGIT_CHARS,
  HYPHEN_CHARS,
  createRegexCandidate,
  extractAsciiDigits,
  uniqueCandidates,
} from "./common";

const PHONE_PATTERN = new RegExp(
  `(^|[^${DIGIT_CHARS}${ASCII_OR_FULLWIDTH_ALPHA_CHARS}${HYPHEN_CHARS}])` +
    `([0０][${DIGIT_CHARS}]{1,4}[\\s\\u3000${HYPHEN_CHARS}][${DIGIT_CHARS}]{1,4}[\\s\\u3000${HYPHEN_CHARS}][${DIGIT_CHARS}]{3,4})` +
    `(?=$|[^${DIGIT_CHARS}${ASCII_OR_FULLWIDTH_ALPHA_CHARS}${HYPHEN_CHARS}])`,
  "g",
);

export function detectPhoneNumbers(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(PHONE_PATTERN)) {
    const prefix = match[1] ?? "";
    const value = match[2];

    if (value === undefined || !isValidJapanesePhoneNumber(value)) {
      continue;
    }

    const start = match.index + prefix.length;
    const candidate = createRegexCandidate({
      category: "PHONE",
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

function isValidJapanesePhoneNumber(value: string): boolean {
  const digits = extractAsciiDigits(value);

  if (!digits.startsWith("0")) {
    return false;
  }

  if (digits.length === 10) {
    return true;
  }

  if (digits.length !== 11) {
    return false;
  }

  return /^(020|050|060|070|080|090|0800)/.test(digits);
}
