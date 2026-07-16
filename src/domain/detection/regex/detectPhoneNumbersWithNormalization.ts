import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import type { DetectionCandidate } from "../mergeCandidates";
import { detectPhoneNumbers } from "./detectPhoneNumbers";
import { mapNormalizedCandidates } from "./mapNormalizedCandidates";

export function detectPhoneNumbersWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, [
    "fullwidth_ascii",
    "hyphen_variants",
    "phone_line_break",
  ]);

  if (normalized.appliedRules.length === 0) {
    return [];
  }

  return mapNormalizedCandidates(
    sourceText,
    normalized,
    detectPhoneNumbers(normalized.text),
  );
}
