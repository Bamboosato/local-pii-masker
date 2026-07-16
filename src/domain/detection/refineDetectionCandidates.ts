import type { MaskCategory } from "../types";
import type { DetectionCandidate } from "./mergeCandidates";

const HIRAGANA_TEXT_PATTERN = /^[ぁ-ゖー]+$/u;
const HIRAGANA_CHARACTER_PATTERN = /^[ぁ-ゖー]$/u;
const FLOOR_ONLY_ADDRESS_PATTERN = /^[0-9０-９]{1,3}(?:階|号室)$/u;
const URL_TEXT_PATTERN = /^https?:\/\//iu;
const NER_OVERLAP_CATEGORIES = new Set<MaskCategory>([
  "ADDRESS",
  "ORGANIZATION",
]);
const STRUCTURED_CATEGORIES = new Set<MaskCategory>([
  "ADDRESS",
  "EMAIL",
  "PHONE",
  "POSTAL_CODE",
]);

type TextRange = { start: number; end: number };

export function refineDetectionCandidates(
  sourceText: string,
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  const phoneCandidates = candidates.filter(
    (candidate) => candidate.category === "PHONE",
  );
  const structuredCandidates = candidates.filter(isStructuredCandidate);
  const rubyReadingRanges = collectRubyReadingRanges(sourceText, candidates);

  return candidates.filter((candidate) => {
    if (
      candidate.category === "POSTAL_CODE" &&
      phoneCandidates.some((phone) => isStrictlyContained(candidate, phone))
    ) {
      return false;
    }

    if (candidate.source !== "ner") {
      return true;
    }

    if (
      candidate.category === "PERSON" &&
      isPersonCandidateOnlyInsideEmail(
        sourceText,
        candidate,
        structuredCandidates,
      )
    ) {
      return false;
    }

    if (
      candidate.category !== "PERSON" &&
      rubyReadingRanges.some((range) => isContainedInRange(candidate, range))
    ) {
      return false;
    }

    if (isPartialHiraganaCandidate(sourceText, candidate)) {
      return false;
    }

    if (
      candidate.category === "ADDRESS" &&
      FLOOR_ONLY_ADDRESS_PATTERN.test(candidate.originalText)
    ) {
      return false;
    }

    if (
      candidate.category !== "PERSON" &&
      structuredCandidates.some(
        (structured) =>
          structured !== candidate &&
          structured.originalText !== candidate.originalText &&
          isStrictlyContained(candidate, structured),
      )
    ) {
      return false;
    }

    if (
      NER_OVERLAP_CATEGORIES.has(candidate.category) &&
      isCandidateOnlyInsideLongerCandidate(
        sourceText,
        candidate,
        candidates,
      )
    ) {
      return false;
    }

    return true;
  });
}

function isPersonCandidateOnlyInsideEmail(
  sourceText: string,
  candidate: DetectionCandidate,
  structuredCandidates: DetectionCandidate[],
): boolean {
  if (candidate.originalText.includes("@")) {
    return false;
  }

  const occurrences = findExactRanges(sourceText, candidate.originalText);

  return (
    occurrences.length > 0 &&
    occurrences.every((occurrence) =>
      structuredCandidates.some(
        (structured) =>
          structured.category === "EMAIL" &&
          isRangeContained(occurrence, getCandidateRange(structured)),
      ),
    )
  );
}

function isCandidateOnlyInsideLongerCandidate(
  sourceText: string,
  candidate: DetectionCandidate,
  candidates: DetectionCandidate[],
): boolean {
  const occurrences = findExactRanges(sourceText, candidate.originalText);
  const longerCandidates = candidates.filter(
    (other) =>
      other !== candidate &&
      other.category === candidate.category &&
      other.originalText.length > candidate.originalText.length,
  );

  return (
    occurrences.length > 0 &&
    longerCandidates.length > 0 &&
    occurrences.every((occurrence) =>
      longerCandidates.some((longer) =>
        findExactRanges(sourceText, longer.originalText).some((container) =>
          isRangeContained(occurrence, container),
        ),
      ),
    )
  );
}

function collectRubyReadingRanges(
  sourceText: string,
  candidates: DetectionCandidate[],
): TextRange[] {
  return candidates.flatMap((candidate) => {
    if (candidate.category !== "PERSON") {
      return [];
    }

    const range = getCandidateRange(candidate);

    if (!range) {
      return [];
    }

    const reading = sourceText
      .slice(range.end)
      .match(/^([ぁ-ゖー]{4,12})(?=[ \t]*(?:$|\r?\n|\|))/u)?.[1];

    return reading
      ? [{ start: range.end, end: range.end + reading.length }]
      : [];
  });
}

function isPartialHiraganaCandidate(
  sourceText: string,
  candidate: DetectionCandidate,
): boolean {
  if (
    !NER_OVERLAP_CATEGORIES.has(candidate.category) ||
    !HIRAGANA_TEXT_PATTERN.test(candidate.originalText)
  ) {
    return false;
  }

  const range = getCandidateRange(candidate);

  if (!range) {
    return false;
  }

  const before = sourceText.slice(Math.max(0, range.start - 1), range.start);
  const after = sourceText.slice(range.end, range.end + 1);

  return (
    HIRAGANA_CHARACTER_PATTERN.test(before) ||
    HIRAGANA_CHARACTER_PATTERN.test(after)
  );
}

function isStructuredCandidate(candidate: DetectionCandidate): boolean {
  return (
    candidate.source === "regex" &&
    (STRUCTURED_CATEGORIES.has(candidate.category) ||
      (candidate.category === "OTHER" &&
        URL_TEXT_PATTERN.test(candidate.originalText)))
  );
}

function isStrictlyContained(
  candidate: DetectionCandidate,
  container: DetectionCandidate,
): boolean {
  const candidateRange = getCandidateRange(candidate);
  const containerRange = getCandidateRange(container);

  return Boolean(
    candidateRange &&
      containerRange &&
      containerRange.start <= candidateRange.start &&
      candidateRange.end <= containerRange.end &&
      (containerRange.start < candidateRange.start ||
        candidateRange.end < containerRange.end),
  );
}

function isContainedInRange(
  candidate: DetectionCandidate,
  container: TextRange,
): boolean {
  const range = getCandidateRange(candidate);

  return Boolean(
    range && container.start <= range.start && range.end <= container.end,
  );
}

function isRangeContained(
  range: TextRange,
  container: TextRange | undefined,
): boolean {
  return Boolean(
    container && container.start <= range.start && range.end <= container.end,
  );
}

function findExactRanges(sourceText: string, value: string): TextRange[] {
  const ranges: TextRange[] = [];
  let start = sourceText.indexOf(value);

  while (start >= 0) {
    ranges.push({ start, end: start + value.length });
    start = sourceText.indexOf(value, start + Math.max(1, value.length));
  }

  return ranges;
}

function getCandidateRange(
  candidate: DetectionCandidate,
): TextRange | undefined {
  if (
    !Number.isInteger(candidate.start) ||
    !Number.isInteger(candidate.end) ||
    candidate.start === undefined ||
    candidate.end === undefined ||
    candidate.start < 0 ||
    candidate.end <= candidate.start
  ) {
    return undefined;
  }

  return { start: candidate.start, end: candidate.end };
}
