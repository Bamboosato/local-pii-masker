import type { MaskCategory } from "../../types";
import type { DetectionCandidate } from "../mergeCandidates";
import { detectEmails } from "../regex/detectEmails";
import { detectJapaneseAddresses } from "../regex/detectJapaneseAddresses";
import { detectPersonNames } from "../regex/detectPersonNames";
import { detectUrls } from "../regex/detectUrls";
import {
  AMBIGUOUS_JAPANESE_SURNAMES,
  COMMON_JAPANESE_SURNAME_SET,
} from "../regex/personNamePatterns";
import { JAPANESE_HONORIFIC_SUFFIXES } from "../extendHonorificCandidates";
import { normalizeJapaneseName } from "../../reference/japanesePersonNames";
import type { NerModelLabel, NerTokenClassificationOutput } from "./types";

const BIO_PREFIX_PATTERN = /^[BI]-/u;
const LEADING_WORD_MARK_PATTERN = /^▁+/u;
const WORD_PIECE_PATTERN = /##/gu;
const SHORT_ALPHA_NUMERIC_PATTERN = /^[0-9A-Za-z０-９Ａ-Ｚａ-ｚ]+$/u;
const SHORT_ALPHA_NUMERIC_MAX_LENGTH = 3;
const SHORT_KANJI_PATTERN = /^[一-龥々]{2}$/u;
const JAPANESE_LETTER_PATTERN = /[一-龥々ぁ-んァ-ヶー]/u;
const ADDRESS_LABEL_CONTEXT_PATTERN =
  /(?:住所|所在地|居住地|出身地|町域|地名)\s*(?:は|[:：])?\s*$/u;
const PERSON_LABEL_CONTEXT_PATTERN =
  /(?:氏名|名前|名義人|担当者?|責任者|患者氏名|申請者|代表者|作成者|承認者|確認者|所有者|利用者|顧客)[ \u3000]*(?:[:：=]|は|が)?[ \u3000]*$/u;
const HONORIFIC_CONTEXT_PATTERN = new RegExp(
  `^[ \\u3000]*(?:${[...JAPANESE_HONORIFIC_SUFFIXES].sort((left, right) => right.length - left.length).join("|")})`,
  "u",
);

const LABEL_CATEGORY_MAP: Record<NerModelLabel, MaskCategory | undefined> = {
  PER: "PERSON",
  ORG: "ORGANIZATION",
  "ORG-P": "ORGANIZATION",
  "ORG-O": "ORGANIZATION",
  LOC: "ADDRESS",
  INS: "ADDRESS",
  PRD: "OTHER",
  EVT: "OTHER",
  O: undefined,
};

export function mapNerOutputsToCandidates(
  outputs: NerTokenClassificationOutput[],
  sourceText: string,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];
  const seen = new Set<string>();
  const structuredCandidates = [
    ...detectEmails(sourceText),
    ...detectUrls(sourceText),
    ...detectJapaneseAddresses(sourceText),
    ...detectPersonNames(sourceText),
  ];

  for (const output of outputs) {
    const rawLabel = output.entity_group ?? output.entity;
    const normalizedLabel = normalizeNerLabel(rawLabel);
    const category = normalizedLabel
      ? LABEL_CATEGORY_MAP[normalizedLabel as NerModelLabel]
      : undefined;

    if (!category) {
      continue;
    }

    const candidateText = extractCandidateText(output, sourceText);

    if (!candidateText || candidateText.trim().length === 0) {
      continue;
    }

    if (!sourceText.includes(candidateText)) {
      continue;
    }

    if (
      shouldDropNerCandidate({
        candidateText,
        normalizedLabel,
        output,
        sourceText,
        structuredCandidates,
      })
    ) {
      continue;
    }

    const key = [
      category,
      candidateText,
      output.start ?? -1,
      output.end ?? -1,
    ].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push({
      originalText: candidateText,
      category,
      source: "ner",
      start: output.start,
      end: output.end,
      confidence: output.score,
    });
  }

  return candidates;
}

export function mapLabelToCategory(
  rawLabel: string | undefined,
): MaskCategory | undefined {
  if (!rawLabel) {
    return undefined;
  }

  const normalizedLabel = normalizeNerLabel(rawLabel);

  return LABEL_CATEGORY_MAP[normalizedLabel as NerModelLabel];
}

function normalizeNerLabel(rawLabel: string | undefined): string | undefined {
  return rawLabel?.replace(BIO_PREFIX_PATTERN, "");
}

function extractCandidateText(
  output: NerTokenClassificationOutput,
  sourceText: string,
): string | undefined {
  if (
    Number.isInteger(output.start) &&
    Number.isInteger(output.end) &&
    output.start !== undefined &&
    output.end !== undefined &&
    output.start >= 0 &&
    output.end > output.start &&
    output.end <= sourceText.length
  ) {
    return sourceText.slice(output.start, output.end);
  }

  return output.word
    ?.replace(LEADING_WORD_MARK_PATTERN, "")
    .replace(WORD_PIECE_PATTERN, "")
    .trim();
}

function shouldDropNerCandidate(params: {
  candidateText: string;
  normalizedLabel?: string;
  output: NerTokenClassificationOutput;
  sourceText: string;
  structuredCandidates: DetectionCandidate[];
}): boolean {
  const {
    candidateText,
    normalizedLabel,
    output,
    sourceText,
    structuredCandidates,
  } = params;
  const isAmbiguousSurname = AMBIGUOUS_JAPANESE_SURNAMES.has(
    normalizeJapaneseName(candidateText),
  );

  if (
    normalizedLabel === "PER" &&
    isAmbiguousSurname &&
    isAmbiguousSurnameWithoutPersonContext({
      candidateText,
      output,
      sourceText,
    })
  ) {
    return true;
  }

  if (
    Array.from(candidateText).length <= 1 &&
    !(normalizedLabel === "PER" && isAmbiguousSurname)
  ) {
    return true;
  }

  if (
    SHORT_ALPHA_NUMERIC_PATTERN.test(candidateText) &&
    candidateText.length <= SHORT_ALPHA_NUMERIC_MAX_LENGTH
  ) {
    return true;
  }

  if (
    structuredCandidates.some(
      (structuredCandidate) =>
        structuredCandidate.originalText !== candidateText &&
        structuredCandidate.originalText.includes(candidateText),
    )
  ) {
    return true;
  }

  if (
    SHORT_KANJI_PATTERN.test(candidateText) &&
    !hasStandaloneOccurrence(sourceText, candidateText)
  ) {
    return true;
  }

  if (
    (normalizedLabel === "LOC" || normalizedLabel === "INS") &&
    COMMON_JAPANESE_SURNAME_SET.has(candidateText) &&
    !hasExplicitAddressContext(sourceText, output.start)
  ) {
    return true;
  }

  return false;
}

function isAmbiguousSurnameWithoutPersonContext(params: {
  candidateText: string;
  output: NerTokenClassificationOutput;
  sourceText: string;
}): boolean {
  if (
    !AMBIGUOUS_JAPANESE_SURNAMES.has(
      normalizeJapaneseName(params.candidateText),
    )
  ) {
    return false;
  }

  const range = resolveUniqueCandidateRange(
    params.sourceText,
    params.candidateText,
    params.output,
  );

  if (!range) {
    return true;
  }

  const before = params.sourceText.slice(
    Math.max(0, range.start - 24),
    range.start,
  );
  const after = params.sourceText.slice(range.end, range.end + 24);

  return !(
    PERSON_LABEL_CONTEXT_PATTERN.test(before) ||
    HONORIFIC_CONTEXT_PATTERN.test(after) ||
    /^[ \u3000]+[一-龥々]/u.test(after)
  );
}

function resolveUniqueCandidateRange(
  sourceText: string,
  candidateText: string,
  output: NerTokenClassificationOutput,
): { start: number; end: number } | undefined {
  if (
    Number.isInteger(output.start) &&
    Number.isInteger(output.end) &&
    output.start !== undefined &&
    output.end !== undefined &&
    output.start >= 0 &&
    output.end > output.start &&
    output.end <= sourceText.length &&
    sourceText.slice(output.start, output.end) === candidateText
  ) {
    return { start: output.start, end: output.end };
  }

  const firstStart = sourceText.indexOf(candidateText);

  if (firstStart < 0) {
    return undefined;
  }

  const nextStart = sourceText.indexOf(
    candidateText,
    firstStart + Math.max(1, candidateText.length),
  );

  return nextStart < 0
    ? { start: firstStart, end: firstStart + candidateText.length }
    : undefined;
}

function hasStandaloneOccurrence(sourceText: string, value: string): boolean {
  let start = sourceText.indexOf(value);

  while (start >= 0) {
    const before = sourceText[start - 1];
    const after = sourceText[start + value.length];

    if (
      (!before || !JAPANESE_LETTER_PATTERN.test(before)) &&
      (!after || !JAPANESE_LETTER_PATTERN.test(after))
    ) {
      return true;
    }

    start = sourceText.indexOf(value, start + value.length);
  }

  return false;
}

function hasExplicitAddressContext(
  sourceText: string,
  candidateStart: number | undefined,
): boolean {
  if (!Number.isInteger(candidateStart) || candidateStart === undefined) {
    return false;
  }

  const before = sourceText.slice(Math.max(0, candidateStart - 16), candidateStart);
  return ADDRESS_LABEL_CONTEXT_PATTERN.test(before);
}
