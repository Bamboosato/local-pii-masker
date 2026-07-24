import type { DetectionCandidate } from "../mergeCandidates";
import { createRegexCandidate, uniqueCandidates } from "./common";
import { detectStructuredPersonNames } from "./detectStructuredPersonNames";
import {
  AMBIGUOUS_JAPANESE_SURNAMES,
  COMMON_JAPANESE_NON_AMBIGUOUS_SURNAMES_PATTERN,
  COMMON_JAPANESE_SURNAMES_PATTERN,
  createSurnameSurfacePattern,
  extendOcrSpacedGivenNameEnd,
} from "./personNamePatterns";

export { COMMON_JAPANESE_SURNAMES } from "./personNamePatterns";

const JAPANESE_PERSON_NAME = `(?:${COMMON_JAPANESE_SURNAMES_PATTERN})[ \u3000]*[一-龥々]{1,4}`;
const NAME_BOUNDARY = String.raw`(?=$|[\s\u3000、。，,.]|さん|様|氏|から|として|である|です|が|は|を|に|へ|と)`;
const JAPANESE_LETTER_OR_DIGIT =
  "一-龥々ぁ-んァ-ヶーA-Za-zＡ-Ｚａ-ｚ0-9０-９";
const NON_PERSON_NAME_SUFFIX_PATTERN =
  /(?:製作所|医院|橋梁|株式会社|有限会社|病院|学校|大学|銀行|公園|模型店|交差点|駅|線|川|峠|材料|部署|地方|側)$/u;

/** Detects a non-ambiguous surname + given name at clear text boundaries. */
const STANDALONE_JAPANESE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^${JAPANESE_LETTER_OR_DIGIT}])`,
    `((?:${COMMON_JAPANESE_NON_AMBIGUOUS_SURNAMES_PATTERN})[一-龥々]{1,4})`,
    String.raw`(?=$|[^${JAPANESE_LETTER_OR_DIGIT}])`,
  ].join(""),
  "gu",
);
const AMBIGUOUS_STANDALONE_JAPANESE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^${JAPANESE_LETTER_OR_DIGIT}])`,
    `((?:${createSurnameSurfacePattern([...AMBIGUOUS_JAPANESE_SURNAMES])})[一-龥々]{2,4})`,
    String.raw`(?=$|[^${JAPANESE_LETTER_OR_DIGIT}])`,
  ].join(""),
  "gu",
);

/** Detect surname + given name in numbered or bullet list items. */
const STANDALONE_LIST_JAPANESE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:^|[\r\n])[ \u3000]*(?:[-*・]|[0-9０-９]+[.)．、])[ \u3000]*`,
    `((?:${COMMON_JAPANESE_SURNAMES_PATTERN})[一-龥々]{1,4})`,
    String.raw`(?=$|[\r\n \u3000、。，,.！？!?|])`,
  ].join(""),
  "gu",
);

/** Detects an ambiguous one-character surname only in an explicit list item. */
const STANDALONE_LIST_JAPANESE_SURNAME_PATTERN = new RegExp(
  [
    String.raw`(?:^|[\r\n])[ \u3000]*(?:[-*・]|[0-9０-９]+[.)．、])[ \u3000]*`,
    `(${createSurnameSurfacePattern([...AMBIGUOUS_JAPANESE_SURNAMES])})`,
    String.raw`(?=$|[\r\n \u3000、。，,.！？!?|])`,
  ].join(""),
  "gu",
);

const SPACED_JAPANESE_NAME_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^一-龥々])`,
    `((?:${COMMON_JAPANESE_SURNAMES_PATTERN})[ \u3000]+[一-龥々]{1,4})`,
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

const AMBIGUOUS_SURNAME_CONTEXT_PATTERN = new RegExp(
  [
    String.raw`(?:氏名|名前|名義人|担当者?|責任者|患者氏名|申請者|代表者|作成者|承認者|確認者|所有者|利用者|顧客)`,
    String.raw`[ \u3000]*(?:[:：=]|は|が)?[ \u3000]*`,
    `(${createSurnameSurfacePattern([...AMBIGUOUS_JAPANESE_SURNAMES])})`,
    String.raw`(?!(?:[ \u3000]+[一-龥々]))`,
    String.raw`(?=$|[\s\u3000、。，,.！？!?「」『』（）()【】\[\]"'：:;；・/]|(?:の|へ|が|は|を|に|と|も|や|で|より|から|まで|です|である|として|について))`,
  ].join(""),
  "gu",
);

const SURNAME_LABEL_PATTERN = new RegExp(
  [
    String.raw`(?:^|[^一-龥々ぁ-んァ-ヶーA-Za-zＡ-Ｚａ-ｚ0-9０-９])`,
    String.raw`(?:姓|名字|苗字)[ \u3000]*(?:[:：=]|は)[ \u3000]*`,
    `(${COMMON_JAPANESE_SURNAMES_PATTERN})`,
    String.raw`(?=$|[\s\u3000、。，,.！？!?（）()【】\[\]])`,
  ].join(""),
  "gu",
);

const CONTEXTUAL_ENGLISH_NAME_PATTERN =
  /(?:氏名|名義人|口座名義)\s*(?:[:：=]\s*)?((?:[A-Z][a-z]+|[A-Z]{2,})(?:[\s\u3000]+(?:[A-Z][a-z]+|[A-Z]{2,})){1,3})(?=$|[\s\u3000、。，,.]|さん|様|氏|から|として|である|です|が|は|を|に|へ)/gu;

export function detectPersonNames(sourceText: string): DetectionCandidate[] {
  return uniqueCandidates([
    ...detectPattern(sourceText, STANDALONE_JAPANESE_NAME_PATTERN).filter(
      (candidate) => !NON_PERSON_NAME_SUFFIX_PATTERN.test(candidate.originalText),
    ),
    ...detectPattern(
      sourceText,
      AMBIGUOUS_STANDALONE_JAPANESE_NAME_PATTERN,
    ).filter(
      (candidate) => !NON_PERSON_NAME_SUFFIX_PATTERN.test(candidate.originalText),
    ),
    ...detectPattern(sourceText, SURNAME_LABEL_PATTERN),
    ...detectPattern(sourceText, STANDALONE_LIST_JAPANESE_SURNAME_PATTERN),
    ...detectPattern(sourceText, STANDALONE_LIST_JAPANESE_NAME_PATTERN),
    ...detectPattern(sourceText, SPACED_JAPANESE_NAME_PATTERN, true),
    ...detectPattern(sourceText, CONTEXTUAL_JAPANESE_NAME_PATTERN, true),
    ...detectPattern(sourceText, ORGANIZATION_POSSESSIVE_NAME_PATTERN, true),
    ...detectPattern(sourceText, AMBIGUOUS_SURNAME_CONTEXT_PATTERN),
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
