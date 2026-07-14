import type { DetectionCandidate } from "../mergeCandidates";
import { mapNormalizedRange } from "../../normalization/detection/mapNormalizedRange";
import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import { detectEmails } from "./detectEmails";

export function detectEmailsWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, ["email_at_spacing"]);

  if (normalized.appliedRules.length === 0) {
    return [];
  }

  return detectEmails(normalized.text).flatMap((candidate) => {
    if (candidate.start === undefined || candidate.end === undefined) {
      return [];
    }

    const appliedEvents = normalized.appliedRules.filter(
      (event) =>
        event.normalizedStart <= candidate.start! &&
        candidate.end! <= event.normalizedEnd,
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
        normalizationRules: ["email_at_spacing"],
      },
    ];
  });
}
