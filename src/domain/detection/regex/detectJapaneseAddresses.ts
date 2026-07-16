import type { DetectionCandidate } from "../mergeCandidates";
import {
  createJapaneseAddressPattern,
  LEADING_ADDRESS_CONTEXT_PATTERN,
} from "../../reference/japaneseAddresses";
import { createRegexCandidate, uniqueCandidates } from "./common";

const JAPANESE_ADDRESS_PATTERN = createJapaneseAddressPattern();

export function detectJapaneseAddresses(
  sourceText: string,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(JAPANESE_ADDRESS_PATTERN)) {
    const prefix = match[1] ?? "";
    const value = match[2];

    if (!value) {
      continue;
    }

    const contextLength =
      value.match(LEADING_ADDRESS_CONTEXT_PATTERN)?.[0].length ?? 0;
    const addressText = value.slice(contextLength);
    const start = match.index + prefix.length + contextLength;
    const candidate = createRegexCandidate({
      category: "ADDRESS",
      sourceText,
      start,
      end: start + addressText.length,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return uniqueCandidates(candidates);
}
