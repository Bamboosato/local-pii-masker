import { normalizeForDetection } from "../../normalization/detection/normalizeForDetection";
import type { DetectionCandidate } from "../mergeCandidates";
import { detectJapaneseAddresses } from "./detectJapaneseAddresses";
import { mapNormalizedCandidates } from "./mapNormalizedCandidates";

export function detectJapaneseAddressesWithNormalization(
  sourceText: string,
): DetectionCandidate[] {
  const normalized = normalizeForDetection(sourceText, [
    "address_line_break",
  ]);

  if (normalized.appliedRules.length === 0) {
    return [];
  }

  return mapNormalizedCandidates(
    sourceText,
    normalized,
    detectJapaneseAddresses(normalized.text),
  );
}
