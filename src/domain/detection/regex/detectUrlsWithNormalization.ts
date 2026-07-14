import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import type { DetectionCandidate } from "../mergeCandidates";
import { detectUrls } from "./detectUrls";
import { mapNormalizedCandidates } from "./mapNormalizedCandidates";

export function detectUrlsWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, [
    "fullwidth_ascii",
    "hyphen_variants",
    "url_line_break",
  ]);

  if (normalized.appliedRules.length === 0) {
    return [];
  }

  return mapNormalizedCandidates(
    sourceText,
    normalized,
    detectUrls(normalized.text),
  );
}
