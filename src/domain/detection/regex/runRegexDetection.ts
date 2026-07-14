import type { DetectionCandidate } from "../mergeCandidates";
import { detectBirthDates } from "./detectBirthDates";
import { detectCredentials } from "./detectCredentials";
import { detectEmails } from "./detectEmails";
import { detectEmailsWithNormalization } from "./detectEmailsWithNormalization";
import { detectIpAddresses } from "./detectIpAddresses";
import { detectJapaneseAddresses } from "./detectJapaneseAddresses";
import { detectPersonNames } from "./detectPersonNames";
import { detectPersonNamesWithNormalization } from "./detectPersonNamesWithNormalization";
import { detectPhoneNumbers } from "./detectPhoneNumbers";
import { detectPostalCodes } from "./detectPostalCodes";
import { detectUrls } from "./detectUrls";
import { detectUrlsWithNormalization } from "./detectUrlsWithNormalization";
import { uniqueCandidates } from "./common";

export function runRegexDetection(sourceText: string): DetectionCandidate[] {
  const urlCandidates = uniqueCandidates([
    ...detectUrls(sourceText),
    ...detectUrlsWithNormalization(sourceText),
  ]);
  const ipAddressCandidates = detectIpAddresses(sourceText).filter(
    (candidate) => !isContainedInAny(candidate, urlCandidates),
  );

  return uniqueCandidates([
    ...detectBirthDates(sourceText),
    ...detectCredentials(sourceText),
    ...detectEmails(sourceText),
    ...detectEmailsWithNormalization(sourceText),
    ...detectPhoneNumbers(sourceText),
    ...detectPostalCodes(sourceText),
    ...urlCandidates,
    ...ipAddressCandidates,
    ...detectJapaneseAddresses(sourceText),
    ...detectPersonNames(sourceText),
    ...detectPersonNamesWithNormalization(sourceText),
  ]);
}

function isContainedInAny(
  candidate: DetectionCandidate,
  containers: DetectionCandidate[],
): boolean {
  if (candidate.start === undefined || candidate.end === undefined) {
    return false;
  }

  return containers.some(
    (container) =>
      container.start !== undefined &&
      container.end !== undefined &&
      container.start <= candidate.start! &&
      candidate.end! <= container.end,
  );
}
