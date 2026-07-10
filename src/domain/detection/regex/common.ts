import type { DetectionCandidate } from "../mergeCandidates";
import type { MaskCategory } from "../../types";

const EDGE_TRIM_PATTERN = new RegExp(
  "^[\\s\\u3000\"'“”‘’「『（(【\\[]+|[\\s\\u3000\"'“”‘’。、，,.;:!?！？」』）)】\\]]+$",
  "u",
);

export const HYPHEN_CHARS = "\\-‐‑‒–—―－ーｰ";
export const DIGIT_CHARS = "0-9０-９";
export const ASCII_OR_FULLWIDTH_ALPHA_CHARS = "A-Za-zＡ-Ｚａ-ｚ";

export function createRegexCandidate(params: {
  category: MaskCategory;
  end: number;
  sourceText: string;
  start: number;
}): DetectionCandidate | undefined {
  const trimmed = trimCandidateRange(
    params.sourceText,
    params.start,
    params.end,
  );
  const originalText = params.sourceText.slice(trimmed.start, trimmed.end);

  if (originalText.trim().length === 0) {
    return undefined;
  }

  return {
    originalText,
    category: params.category,
    source: "regex",
    start: trimmed.start,
    end: trimmed.end,
  };
}

export function uniqueCandidates(
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  const seen = new Set<string>();
  const unique: DetectionCandidate[] = [];

  for (const candidate of candidates) {
    const key = [
      candidate.category,
      candidate.originalText,
      candidate.start ?? -1,
      candidate.end ?? -1,
    ].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

export function extractAsciiDigits(value: string): string {
  return Array.from(value, (character) => {
    if (character >= "０" && character <= "９") {
      return String.fromCharCode(character.charCodeAt(0) - 0xfee0);
    }

    return character;
  })
    .filter((character) => character >= "0" && character <= "9")
    .join("");
}

function trimCandidateRange(
  sourceText: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let nextStart = start;
  let nextEnd = end;

  while (
    nextStart < nextEnd &&
    sourceText.slice(nextStart, nextStart + 1).match(EDGE_TRIM_PATTERN)
  ) {
    nextStart += 1;
  }

  while (
    nextEnd > nextStart &&
    sourceText.slice(nextEnd - 1, nextEnd).match(EDGE_TRIM_PATTERN)
  ) {
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
}
