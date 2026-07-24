import type { DetectionCandidate } from "./mergeCandidates";
import { uniqueCandidates } from "./regex/common";
import { COMMON_JAPANESE_SURNAMES } from "./regex/personNamePatterns";
import { normalizeJapaneseName } from "../reference/japanesePersonNames";

const SORTED_SURNAMES = [...COMMON_JAPANESE_SURNAMES].sort(
  (left, right) => right.length - left.length,
);
const RUBY_ADJACENT_FULL_NAME_PATTERN = new RegExp(
  `(^|[\\r\\n|])([ \\t]*(?:[-*+][ \\t]+)?)((?:${SORTED_SURNAMES.join("|")})[一-龥々]{1,4})([ぁ-ゖー]{4,12})(?=[ \\t]*(?:$|\\r?\\n|\\|))`,
  "gu",
);
const COMPACT_JAPANESE_NAME_PATTERN = /^[一-龥々]{3,7}$/u;
const MARKDOWN_FENCED_COMPACT_NAME_PATTERN =
  /```[^\r\n]*\r?\n[ \t]*([一-龥々]{4,7})[ \t]*\r?\n```/gu;
const SURNAME_PRECEDING_BOUNDARY =
  /(?:^|[\s\u3000、。，,.「」『』"'（）()はがをにへともので])$/u;
const SURNAME_FOLLOWING_BOUNDARY =
  /^(?:$|[\s\u3000、。，,.「」『』"'（）()]+|さん|様|氏|部長|課長|社長|主任|先生|から|として|である|です|が|は|を|に|へ|と|も)/u;
const SPACED_NAME_CONTINUATION = /^[ \u3000]+[一-龥々]/u;
const JAPANESE_NAME_CHARACTER_PATTERN = /^[一-龥々]$/u;

type TextRange = { start: number; end: number };

export function enrichPersonCandidates(
  sourceText: string,
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  const personCandidates = candidates.filter(
    (candidate) => candidate.category === "PERSON",
  );
  const fencedFullNameCandidates = deriveFencedFullNameCandidates(
    sourceText,
    personCandidates,
  );
  const aiSpacedFullNameCandidates = deriveAiSpacedFullNameCandidates(
    sourceText,
    candidates,
  );
  const rubyAdjacentFullNameCandidates =
    deriveRubyAdjacentFullNameCandidates(sourceText);
  const enrichedPersonCandidates = [
    ...personCandidates,
    ...fencedFullNameCandidates,
    ...aiSpacedFullNameCandidates,
    ...rubyAdjacentFullNameCandidates,
  ];
  const surnameEvidence = collectSurnameEvidence(enrichedPersonCandidates);
  const fullNameRanges = enrichedPersonCandidates.flatMap((candidate) =>
    findExactRanges(sourceText, candidate.originalText),
  );
  const derivedCandidates: DetectionCandidate[] = [];

  for (const [surname, fullNames] of surnameEvidence) {
    const surnameRanges = findExactRanges(sourceText, surname);

    if (
      surname.length < 2 ||
      fullNames.size < 1 ||
      enrichedPersonCandidates.some(
        (candidate) => candidate.originalText === surname,
      )
    ) {
      continue;
    }

    for (const range of surnameRanges) {
      if (
        isInsideFullName(range, fullNameRanges) ||
        !hasStandaloneSurnameBoundary(sourceText, range)
      ) {
        continue;
      }

      derivedCandidates.push({
        originalText: surname,
        category: "PERSON",
        source: "regex",
        start: range.start,
        end: range.end,
      });
    }
  }

  return [
    ...candidates,
    ...uniqueCandidates([
      ...fencedFullNameCandidates,
      ...aiSpacedFullNameCandidates,
      ...rubyAdjacentFullNameCandidates,
      ...derivedCandidates,
    ]),
  ];
}

function deriveRubyAdjacentFullNameCandidates(
  sourceText: string,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(RUBY_ADJACENT_FULL_NAME_PATTERN)) {
    const prefix = match[1] ?? "";
    const indentation = match[2] ?? "";
    const name = match[3];

    if (!name || !splitCommonJapaneseName(name)) {
      continue;
    }

    const start = match.index + prefix.length + indentation.length;
    candidates.push({
      originalText: name,
      category: "PERSON",
      source: "regex",
      start,
      end: start + name.length,
    });
  }

  return uniqueCandidates(candidates);
}

function deriveAiSpacedFullNameCandidates(
  sourceText: string,
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  const compactAiNames = new Set<string>();
  const existingRegexCandidates = new Set(
    candidates
      .filter((candidate) => candidate.source === "regex")
      .map(toCandidateRangeKey),
  );
  const derivedCandidates: DetectionCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.category !== "PERSON" || candidate.source !== "ner") {
      continue;
    }

    const parsed = splitCommonJapaneseName(candidate.originalText);

    if (parsed && candidate.originalText === parsed.compactName) {
      compactAiNames.add(parsed.compactName);
    }
  }

  for (const compactName of compactAiNames) {
    const spacedNamePattern = new RegExp(
      Array.from(compactName).join("[ \\u3000]?"),
      "gu",
    );

    for (const match of sourceText.matchAll(spacedNamePattern)) {
      const originalText = match[0];

      if (!/[ \u3000]/u.test(originalText)) {
        continue;
      }

      const range = {
        start: match.index,
        end: match.index + originalText.length,
      };

      if (!hasFullNameBoundary(sourceText, range)) {
        continue;
      }

      const candidate: DetectionCandidate = {
        originalText,
        category: "PERSON",
        source: "regex",
        start: range.start,
        end: range.end,
      };
      const candidateKey = toCandidateRangeKey(candidate);

      if (existingRegexCandidates.has(candidateKey)) {
        continue;
      }

      existingRegexCandidates.add(candidateKey);
      derivedCandidates.push(candidate);
    }
  }

  return uniqueCandidates(derivedCandidates);
}

function deriveFencedFullNameCandidates(
  sourceText: string,
  personCandidates: DetectionCandidate[],
): DetectionCandidate[] {
  const surnameEvidence = collectSurnameEvidence(personCandidates);
  const fullNameRanges = personCandidates.flatMap((candidate) =>
    findExactRanges(sourceText, candidate.originalText),
  );
  const surnamesUsedAlone = new Set(
    [...surnameEvidence.keys()].filter((surname) =>
      findExactRanges(sourceText, surname).some(
        (range) =>
          !isInsideFullName(range, fullNameRanges) &&
          hasStandaloneSurnameBoundary(sourceText, range),
      ),
    ),
  );
  const existingNames = new Set(
    personCandidates.map((candidate) =>
      candidate.originalText.replace(/[ \u3000]+/gu, ""),
    ),
  );
  const derivedCandidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(MARKDOWN_FENCED_COMPACT_NAME_PATTERN)) {
    const value = match[1];
    const parsed = value ? splitCommonJapaneseName(value) : undefined;

    if (
      !value ||
      !parsed ||
      parsed.compactName.length - parsed.surname.length < 2 ||
      !surnamesUsedAlone.has(parsed.surname) ||
      existingNames.has(parsed.compactName)
    ) {
      continue;
    }

    const start = match.index + match[0].indexOf(value);
    derivedCandidates.push({
      originalText: value,
      category: "PERSON",
      source: "regex",
      start,
      end: start + value.length,
    });
  }

  return uniqueCandidates(derivedCandidates);
}

function collectSurnameEvidence(
  candidates: DetectionCandidate[],
): Map<string, Set<string>> {
  const evidence = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    const parsed = splitCommonJapaneseName(candidate.originalText);

    if (!parsed) {
      continue;
    }

    const names = evidence.get(parsed.surname) ?? new Set<string>();
    names.add(parsed.compactName);
    evidence.set(parsed.surname, names);
  }

  return evidence;
}

function splitCommonJapaneseName(
  value: string,
): { surname: string; compactName: string } | undefined {
  const compactName = value.replace(/[ \u3000]+/gu, "");
  const normalizedCompactName = normalizeJapaneseName(compactName);

  if (!COMPACT_JAPANESE_NAME_PATTERN.test(normalizedCompactName)) {
    return undefined;
  }

  const surname = SORTED_SURNAMES.find(
    (item) =>
      normalizedCompactName.startsWith(normalizeJapaneseName(item)) &&
      normalizedCompactName.length > normalizeJapaneseName(item).length &&
      normalizedCompactName.length - normalizeJapaneseName(item).length <= 4,
  );

  return surname ? { surname, compactName } : undefined;
}

function findExactRanges(sourceText: string, value: string): TextRange[] {
  const ranges: TextRange[] = [];
  let start = sourceText.indexOf(value);

  while (start >= 0) {
    ranges.push({ start, end: start + value.length });
    start = sourceText.indexOf(value, start + value.length);
  }

  return ranges;
}

function isInsideFullName(range: TextRange, fullNameRanges: TextRange[]): boolean {
  return fullNameRanges.some(
    (fullNameRange) =>
      fullNameRange.start <= range.start && range.end <= fullNameRange.end,
  );
}

function hasStandaloneSurnameBoundary(
  sourceText: string,
  range: TextRange,
): boolean {
  const before = sourceText.slice(0, range.start);
  const after = sourceText.slice(range.end);

  return (
    SURNAME_PRECEDING_BOUNDARY.test(before) &&
    SURNAME_FOLLOWING_BOUNDARY.test(after) &&
    !SPACED_NAME_CONTINUATION.test(after)
  );
}

function hasFullNameBoundary(sourceText: string, range: TextRange): boolean {
  const before = sourceText.slice(Math.max(0, range.start - 1), range.start);
  const after = sourceText.slice(range.end, range.end + 1);

  return (
    !JAPANESE_NAME_CHARACTER_PATTERN.test(before) &&
    !JAPANESE_NAME_CHARACTER_PATTERN.test(after)
  );
}

function toCandidateRangeKey(candidate: DetectionCandidate): string {
  return [
    candidate.category,
    candidate.originalText,
    candidate.start ?? -1,
    candidate.end ?? -1,
  ].join("\u0000");
}
