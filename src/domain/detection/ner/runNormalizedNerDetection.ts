import { mapNormalizedRange } from "../../normalization/detection/mapNormalizedRange";
import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import type { DetectionCandidate } from "../mergeCandidates";
import {
  runChunkedNerDetection,
  type TokenClassifier,
} from "./runChunkedNerDetection";

export async function runNormalizedNerDetection(
  sourceText: string,
  classifier: TokenClassifier,
): Promise<DetectionCandidate[]> {
  const normalized = normalizeForDetection(sourceText, [
    "japanese_inter_character_space",
    "person_name_line_break",
  ]);
  const candidates = await runChunkedNerDetection(normalized.text, classifier);

  return candidates.flatMap((candidate) => {
    const normalizedStart =
      candidate.start ?? normalized.text.indexOf(candidate.originalText);
    const normalizedEnd =
      candidate.end ?? normalizedStart + candidate.originalText.length;
    const originalRange = mapNormalizedRange(normalized, {
      start: normalizedStart,
      end: normalizedEnd,
    });

    if (!originalRange) {
      return [];
    }

    const normalizationRules = [
      ...new Set(
        normalized.appliedRules
          .filter(
            (event) =>
              event.normalizedStart < normalizedEnd &&
              normalizedStart < event.normalizedEnd,
          )
          .map((event) => event.rule),
      ),
    ];

    return [
      {
        ...candidate,
        originalText: sourceText.slice(originalRange.start, originalRange.end),
        start: originalRange.start,
        end: originalRange.end,
        ...(normalizationRules.length > 0 ? { normalizationRules } : {}),
      },
    ];
  });
}
