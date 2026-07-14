import type { DetectionCandidate } from "../mergeCandidates";
import { createRegexCandidate, uniqueCandidates } from "./common";
import { detectStructuredPersonNames } from "./detectStructuredPersonNames";
import {
  COMMON_JAPANESE_SURNAMES,
  extendOcrSpacedGivenNameEnd,
} from "./personNamePatterns";

export { COMMON_JAPANESE_SURNAMES } from "./personNamePatterns";

const JAPANESE_PERSON_NAME = `(?:${COMMON_JAPANESE_SURNAMES})[ \u3000]*[一-龥々]{1,4}`;
const NAME_BOUNDARY = String.raw`(?=$|[\s\u3000、。，,.]|さん|様|氏|から|として|である|です|が|は|を|に|へ|と)`;

const SPACED_JAPANESE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^一-龥々])`,
    `((?:${COMMON_JAPANESE_SURNAMES})[ \u3000]+[一-龥々]{1,4})`,
    NAME_BOUNDARY,
  ].join(""),
  "gu",
);

const CONTEXTUAL_JAPANESE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:`,
    String.raw`氏名|名義人|口座名義|顧客である|`,
    String.raw`[一-龥々ぁ-んァ-ヶー・A-Za-z0-9]+(?:部長|担当|担当者|部)の`,
    String.raw`)`,
    String.raw`[ \u3000]*`,
    `(${JAPANESE_PERSON_NAME})`,
    NAME_BOUNDARY,
  ].join(""),
  "gu",
);

const ORGANIZATION_POSSESSIVE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:会社|法人|組織|事業者|テクノロジー|ソリューションズ)の`,
    String.raw`[ \u3000]*`,
    `(${JAPANESE_PERSON_NAME})`,
    NAME_BOUNDARY,
  ].join(""),
  "gu",
);

const CONTEXTUAL_ENGLISH_NAME_PATTERN =
  /(?:氏名|名義人|口座名義)\s*(?:[:：=]\s*)?((?:[A-Z][a-z]+|[A-Z]{2,})(?:[\s\u3000]+(?:[A-Z][a-z]+|[A-Z]{2,})){1,3})(?=$|[\s\u3000、。，,.]|さん|様|氏|から|として|である|です|が|は|を|に|へ)/gu;

export function detectPersonNames(sourceText: string): DetectionCandidate[] {
  return uniqueCandidates([
    ...detectPattern(sourceText, SPACED_JAPANESE_NAME_PATTERN, true),
    ...detectPattern(sourceText, CONTEXTUAL_JAPANESE_NAME_PATTERN, true),
    ...detectPattern(sourceText, ORGANIZATION_POSSESSIVE_NAME_PATTERN, true),
    ...detectPattern(sourceText, CONTEXTUAL_ENGLISH_NAME_PATTERN),
    ...detectStructuredPersonNames(sourceText),
  ]);
}

function detectPattern(
  sourceText: string,
  pattern: RegExp,
  extendOcrSpacing = false,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(pattern)) {
    const value = match[1];

    if (value === undefined) {
      continue;
    }

    const start = match.index + match[0].indexOf(value);
    const matchedEnd = start + value.length;
    const end = extendOcrSpacing
      ? extendOcrSpacedGivenNameEnd(sourceText, start, matchedEnd)
      : matchedEnd;
    const candidate = createRegexCandidate({
      category: "PERSON",
      sourceText,
      start,
      end,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}
