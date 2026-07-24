import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import type { DetectionCandidate } from "../mergeCandidates";
import { detectPersonNames } from "./detectPersonNames";
import { mapNormalizedCandidates } from "./mapNormalizedCandidates";

/**
 * Runs the regular person-name detector against OCR-repaired text and maps
 * each result back to its exact source range, including removed line breaks.
 */
export function detectPersonNamesWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, [
    "person_name_line_break",
    "japanese_inter_character_space",
  ]);

  if (normalized.appliedRules.length === 0) {
    return [];
  }

  return mapNormalizedCandidates(
    sourceText,
    normalized,
    detectPersonNames(normalized.text),
  );
}
