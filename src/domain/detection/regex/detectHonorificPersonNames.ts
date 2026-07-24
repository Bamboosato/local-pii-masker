import type { DetectionCandidate } from "../mergeCandidates";
import { createRegexCandidate, uniqueCandidates } from "./common";
import { COMMON_JAPANESE_SURNAMES_PATTERN } from "./personNamePatterns";
import { JAPANESE_HONORIFIC_SUFFIXES } from "../extendHonorificCandidates";

const SORTED_HONORIFIC_SUFFIXES = [...JAPANESE_HONORIFIC_SUFFIXES].sort(
  (left, right) => right.length - left.length,
);
const HONORIFIC_SUFFIXES = SORTED_HONORIFIC_SUFFIXES.join("|");
// 「仕様」は「仕」+「様」と分解できるため、一般語なのに敬称付き人名へ
// 誤認される。敬称検出を文脈自由に保つため、既知の語彙だけを明示的に除外する。
const NON_PERSON_HONORIFIC_TERM_PATTERN = /仕様$/u;
const JAPANESE_NAME_WITH_HONORIFIC_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^一-龥々])`,
    `((?:${COMMON_JAPANESE_SURNAMES_PATTERN})[ \\u3000]*(?:[一-龥々]{1,4})?[ \\u3000]*(?:${HONORIFIC_SUFFIXES}))`,
    String.raw`(?=$|[\s\u3000、。，,.！？!?「」『』（）()【】\[\]"'：:;；・/]|(?:の|へ|が|は|を|に|と|も|や|で|より|から|まで|です|である|として|について))`,
  ].join(""),
  "gu",
);

// A direct Kanji-string + honorific match is intentionally context-free. The
// user has decided that the honorific itself is identifying information, so
// an uncommon surname must not depend on the NER model or surname dictionary.
// The boundary excludes an internal whitespace fragment such as `山田 太郎 様`;
// that spelling is handled by the dictionary-aware pattern above.
const GENERIC_KANJI_WITH_HONORIFIC_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^一-龥々 \u3000]|[はがをにへともやでのりら])`,
    String.raw`[ \u3000]*`,
    `([一-龥々]{1,20}[ \\u3000]*(?:${HONORIFIC_SUFFIXES}))`,
    String.raw`(?=$|[\s\u3000、。，,.！？!?「」『』（）()【】\[\]"'：:;；・/]|(?:の|へ|が|は|を|に|と|も|や|で|より|から|まで|です|である|として|について))`,
  ].join(""),
  "gu",
);

/**
 * Detects a Kanji string followed by one of the configured honorifics or
 * role titles. The generic pattern deliberately does not require a context
 * label or a common surname because the suffix itself is sensitive.
 */
export function detectHonorificPersonNames(
  sourceText: string,
): DetectionCandidate[] {
  return uniqueCandidates([
    ...detectPattern(sourceText, JAPANESE_NAME_WITH_HONORIFIC_PATTERN),
    ...detectPattern(sourceText, GENERIC_KANJI_WITH_HONORIFIC_PATTERN).filter(
      (candidate) => !NON_PERSON_HONORIFIC_TERM_PATTERN.test(candidate.originalText),
    ),
  ]);
}

function detectPattern(
  sourceText: string,
  pattern: RegExp,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(pattern)) {
    const value = match[1];

    if (value === undefined) {
      continue;
    }

    const start = match.index + match[0].indexOf(value);
    const candidate = createRegexCandidate({
      category: "PERSON",
      sourceText,
      start,
      end: start + value.length,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}
