import type { DetectionCandidate } from "../mergeCandidates";
import { uniqueCandidates } from "./common";

const IPV4_PATTERN =
  /(^|[^0-9.])([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?![0-9.])/gmu;
const IPV6_PATTERN =
  /(^|[^A-Za-z0-9:])([A-Fa-f0-9:]*:[A-Fa-f0-9:]+)(?![A-Za-z0-9:])/gmu;
const IPV6_GROUP_PATTERN = /^[A-Fa-f0-9]{1,4}$/u;

export function detectIpAddresses(sourceText: string): DetectionCandidate[] {
  return uniqueCandidates([
    ...collectMatches(sourceText, IPV4_PATTERN, isValidIpv4),
    ...collectMatches(sourceText, IPV6_PATTERN, isValidIpv6),
  ]);
}

function collectMatches(
  sourceText: string,
  pattern: RegExp,
  isValid: (value: string) => boolean,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(pattern)) {
    const prefix = match[1];
    const value = match[2];

    if (!isValid(value)) {
      continue;
    }

    const start = match.index + prefix.length;
    candidates.push({
      originalText: value,
      category: "OTHER",
      source: "regex",
      start,
      end: start + value.length,
    });
  }

  return candidates;
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");

  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^(?:0|[1-9][0-9]{0,2})$/u.test(part) && Number(part) <= 255,
    )
  );
}

function isValidIpv6(value: string): boolean {
  if (
    value.includes(":::") ||
    (value.startsWith(":") && !value.startsWith("::")) ||
    (value.endsWith(":") && !value.endsWith("::"))
  ) {
    return false;
  }

  const compressionIndex = value.indexOf("::");
  const hasCompression = compressionIndex >= 0;

  if (hasCompression && value.indexOf("::", compressionIndex + 2) >= 0) {
    return false;
  }

  const groups = value.split(":").filter((group) => group.length > 0);

  if (!groups.every((group) => IPV6_GROUP_PATTERN.test(group))) {
    return false;
  }

  return hasCompression ? groups.length < 8 : groups.length === 8;
}
