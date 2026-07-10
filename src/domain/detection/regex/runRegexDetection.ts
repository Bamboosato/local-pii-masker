import type { DetectionCandidate } from "../mergeCandidates";
import { detectEmails } from "./detectEmails";
import { detectPhoneNumbers } from "./detectPhoneNumbers";
import { detectPostalCodes } from "./detectPostalCodes";
import { uniqueCandidates } from "./common";

export function runRegexDetection(sourceText: string): DetectionCandidate[] {
  return uniqueCandidates([
    ...detectEmails(sourceText),
    ...detectPhoneNumbers(sourceText),
    ...detectPostalCodes(sourceText),
  ]);
}
