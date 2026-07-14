import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import {
  COMMON_JAPANESE_SURNAME_SET,
} from "../../reference/japanesePersonNames";
import type { DetectionCandidate } from "../mergeCandidates";

const KANJI_NAME_PATTERN = /^[一-龥々]{3,7}$/u;
const SORTED_COMMON_SURNAMES = [...COMMON_JAPANESE_SURNAME_SET].sort(
  (left, right) => right.length - left.length,
);

export function detectPersonNamesWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, [
    "japanese_inter_character_space",
  ]);

  return normalized.appliedRules.flatMap((event) => {
    if (event.rule !== "japanese_inter_character_space") {
      return [];
    }

    const compactName = normalized.text.slice(
      event.normalizedStart,
      event.normalizedEnd,
    );

    if (!isCommonJapaneseFullName(compactName)) {
      return [];
    }

    return [
      {
        originalText: sourceText.slice(event.originalStart, event.originalEnd),
        category: "PERSON",
        source: "regex",
        start: event.originalStart,
        end: event.originalEnd,
        normalizationRules: [event.rule],
      } satisfies DetectionCandidate,
    ];
  });
}

function isCommonJapaneseFullName(value: string): boolean {
  if (!KANJI_NAME_PATTERN.test(value)) {
    return false;
  }

  return SORTED_COMMON_SURNAMES.some((surname) => {
    if (!value.startsWith(surname)) {
      return false;
    }

    const givenNameLength = value.length - surname.length;
    return givenNameLength >= 1 && givenNameLength <= 4;
  });
}
