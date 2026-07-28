import type { MaskCategory } from "../types";
import type { DetectionCandidate } from "./mergeCandidates";

/**
 * Honorifics and role titles that can reveal who an otherwise masked name or
 * organization refers to. Longer titles must be checked first so that a
 * suffix such as `部長代理` is not truncated to `部長`.
 */
export const JAPANESE_HONORIFIC_SUFFIXES = [
  "最高経営責任者",
  "執行役員",
  "事業部長",
  "部長代理",
  "マネージャー",
  "相談役",
  "監査役",
  "理事長",
  "副社長",
  "御法人",
  "貴法人",
  "御中",
  "貴社",
  "御社",
  "貴行",
  "御行",
  "貴院",
  "御院",
  "貴校",
  "御校",
  "貴庁",
  "御庁",
  "先生",
  "チーフ",
  "リーダー",
  "顧問",
  "会長",
  "社長",
  "専務",
  "常務",
  "理事",
  "本部長",
  "部長",
  "次長",
  "室長",
  "課長",
  "参事",
  "主幹",
  "係長",
  "主任",
  "ちゃん",
  "さん",
  "様",
  "殿",
  "氏",
  "君",
  "くん",
  "CEO",
] as const;

const HONORIFIC_CATEGORIES = new Set<MaskCategory>([
  "PERSON",
  "ORGANIZATION",
]);
const SORTED_HONORIFIC_SUFFIXES = [...JAPANESE_HONORIFIC_SUFFIXES].sort(
  (left, right) => right.length - left.length,
);
const HONORIFIC_SUFFIX_PATTERN = new RegExp(
  `^[ \\u3000\\t]*(?:${SORTED_HONORIFIC_SUFFIXES.join("|")})(?=$|[\\s\\u3000、。，,.！？!?「」『』（）()【】\\[\\]"'：:;；・/]|(?:の|へ|が|は|を|に|と|も|や|で|より|から|まで|です|である|として|について))`,
  "u",
);

/**
 * Extends PERSON/ORGANIZATION candidates with a directly following honorific
 * or role title while retaining the original source spelling and range.
 * Candidates without a reliable unique source range are left unchanged.
 */
export function extendHonorificCandidates(
  sourceText: string,
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  return candidates.map((candidate) => {
    if (!HONORIFIC_CATEGORIES.has(candidate.category)) {
      return candidate;
    }

    const range = resolveCandidateRange(sourceText, candidate);

    if (!range) {
      return candidate;
    }

    const suffix = sourceText.slice(range.end).match(HONORIFIC_SUFFIX_PATTERN)?.[0];

    if (!suffix) {
      return candidate;
    }

    const end = range.end + suffix.length;

    return {
      ...candidate,
      originalText: sourceText.slice(range.start, end),
      ...(candidate.restorationText !== undefined
        ? { restorationText: candidate.restorationText + suffix }
        : {}),
      start: range.start,
      end,
    };
  });
}

function resolveCandidateRange(
  sourceText: string,
  candidate: DetectionCandidate,
): { start: number; end: number } | undefined {
  if (
    Number.isInteger(candidate.start) &&
    Number.isInteger(candidate.end) &&
    candidate.start !== undefined &&
    candidate.end !== undefined &&
    candidate.start >= 0 &&
    candidate.end > candidate.start &&
    candidate.end <= sourceText.length &&
    sourceText.slice(candidate.start, candidate.end) === candidate.originalText
  ) {
    return { start: candidate.start, end: candidate.end };
  }

  const firstStart = sourceText.indexOf(candidate.originalText);

  if (firstStart < 0) {
    return undefined;
  }

  const nextStart = sourceText.indexOf(
    candidate.originalText,
    firstStart + Math.max(1, candidate.originalText.length),
  );

  return nextStart < 0
    ? { start: firstStart, end: firstStart + candidate.originalText.length }
    : undefined;
}
