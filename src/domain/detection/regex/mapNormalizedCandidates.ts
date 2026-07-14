import type { NormalizedTextResult } from "../../normalization/detection/types";
import { mapNormalizedRange } from "../../normalization/detection/mapNormalizedRange";
import type { DetectionCandidate } from "../mergeCandidates";

export function mapNormalizedCandidates(
  sourceText: string,
  normalized: NormalizedTextResult,
  candidates: DetectionCandidate[],
): DetectionCandidate[] {
  return candidates.flatMap((candidate) => {
    if (candidate.start === undefined || candidate.end === undefined) {
      return [];
    }

    const appliedEvents = normalized.appliedRules.filter(
      (event) =>
        event.normalizedStart < candidate.end! &&
        candidate.start! < event.normalizedEnd,
    );

    if (appliedEvents.length === 0) {
      return [];
    }

    const originalRange = mapNormalizedRange(normalized, {
      start: candidate.start,
      end: candidate.end,
    });

    if (!originalRange) {
      return [];
    }

    return [
      {
        ...candidate,
        originalText: sourceText.slice(originalRange.start, originalRange.end),
        start: originalRange.start,
        end: originalRange.end,
        normalizationRules: [
          ...new Set(appliedEvents.map((event) => event.rule)),
        ],
      },
    ];
  });
}
