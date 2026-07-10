import type { DetectionCandidate } from "../mergeCandidates";
import { createRegexCandidate, uniqueCandidates } from "./common";

const EMAIL_PATTERN =
  /(^|[^A-Za-z0-9._%+-])([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?=$|[^A-Za-z0-9._%+-])/g;

export function detectEmails(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(EMAIL_PATTERN)) {
    const prefix = match[1] ?? "";
    const value = match[2];

    if (value === undefined || !isValidEmail(value)) {
      continue;
    }

    const start = match.index + prefix.length;
    const candidate = createRegexCandidate({
      category: "EMAIL",
      sourceText,
      start,
      end: start + value.length,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return uniqueCandidates(candidates);
}

function isValidEmail(value: string): boolean {
  const atIndex = value.indexOf("@");

  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@")) {
    return false;
  }

  const localPart = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  const domainLabels = domain.split(".");
  const topLevelDomain = domainLabels.at(-1);

  if (
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..")
  ) {
    return false;
  }

  return (
    topLevelDomain !== undefined &&
    /^[A-Za-z]{2,}$/.test(topLevelDomain) &&
    domainLabels.every(isValidDomainLabel)
  );
}

function isValidDomainLabel(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.endsWith("-") &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}
