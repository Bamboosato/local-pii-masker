import type { NormalizedTextResult, TextRange } from "./types";

export function mapNormalizedRange(
  normalized: NormalizedTextResult,
  range: TextRange,
): TextRange | undefined {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > normalized.text.length
  ) {
    return undefined;
  }

  const first = normalized.mappings[range.start];
  const last = normalized.mappings[range.end - 1];

  if (!first || !last) {
    return undefined;
  }

  return {
    start: first.originalStart,
    end: last.originalEnd,
  };
}
