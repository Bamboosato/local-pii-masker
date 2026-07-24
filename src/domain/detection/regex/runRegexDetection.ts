import type { DetectionCandidate } from "../mergeCandidates";
import { detectBirthDates } from "./detectBirthDates";
import { detectCredentials } from "./detectCredentials";
import { detectEmails } from "./detectEmails";
import { detectEmailsWithNormalization } from "./detectEmailsWithNormalization";
import { detectHonorificPersonNames } from "./detectHonorificPersonNames";
import { detectIpAddresses } from "./detectIpAddresses";
import { detectJapaneseAddresses } from "./detectJapaneseAddresses";
import { detectJapaneseAddressesWithNormalization } from "./detectJapaneseAddressesWithNormalization";
import { detectOrganizationsWithNormalization } from "./detectOrganizationsWithNormalization";
import { detectPersonNames } from "./detectPersonNames";
import { detectPersonNamesWithNormalization } from "./detectPersonNamesWithNormalization";
import { detectPhoneNumbers } from "./detectPhoneNumbers";
import { detectPhoneNumbersWithNormalization } from "./detectPhoneNumbersWithNormalization";
import { detectPostalCodes } from "./detectPostalCodes";
import { detectUrls } from "./detectUrls";
import { detectUrlsWithNormalization } from "./detectUrlsWithNormalization";
import { uniqueCandidates } from "./common";

export function runRegexDetection(sourceText: string): DetectionCandidate[] {
  const emailCandidates = preferNormalizedCandidates(
    detectEmails(sourceText),
    detectEmailsWithNormalization(sourceText),
  );
  const urlCandidates = preferNormalizedCandidates(
    detectUrls(sourceText),
    detectUrlsWithNormalization(sourceText),
  );
  const addressCandidates = preferNormalizedCandidates(
    detectJapaneseAddresses(sourceText),
    detectJapaneseAddressesWithNormalization(sourceText),
  );
  const phoneCandidates = preferNormalizedCandidates(
    detectPhoneNumbers(sourceText),
    detectPhoneNumbersWithNormalization(sourceText),
  );
  const postalCodeCandidates = detectPostalCodes(sourceText).filter(
    (candidate) => !isContainedInAny(candidate, phoneCandidates),
  );
  const ipAddressCandidates = detectIpAddresses(sourceText).filter(
    (candidate) => !isContainedInAny(candidate, urlCandidates),
  );

  return uniqueCandidates([
    ...detectBirthDates(sourceText),
    ...detectCredentials(sourceText),
    ...emailCandidates,
    ...phoneCandidates,
    ...postalCodeCandidates,
    ...urlCandidates,
    ...ipAddressCandidates,
    ...detectOrganizationsWithNormalization(sourceText),
    ...addressCandidates,
    ...detectHonorificPersonNames(sourceText),
    ...detectPersonNames(sourceText),
    ...detectPersonNamesWithNormalization(sourceText),
  ]);
}

function preferNormalizedCandidates(
  plainCandidates: DetectionCandidate[],
  normalizedCandidates: DetectionCandidate[],
): DetectionCandidate[] {
  return uniqueCandidates([
    ...normalizedCandidates,
    ...plainCandidates.filter(
      (candidate) => !isContainedInAny(candidate, normalizedCandidates),
    ),
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
