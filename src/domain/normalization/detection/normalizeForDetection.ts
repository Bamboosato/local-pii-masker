import type {
  DetectionNormalizationRule,
  NormalizationEvent,
  NormalizedTextResult,
} from "./types";

type MappedCodeUnit = {
  value: string;
  originalStart: number;
  originalEnd: number;
};

type PendingNormalizationEvent = Omit<
  NormalizationEvent,
  "normalizedStart" | "normalizedEnd"
>;

const DEFAULT_RULES: DetectionNormalizationRule[] = ["email_at_spacing"];
const EMAIL_LOCAL_CHARACTER_CLASS = "A-Za-z0-9.!#$%&'*+/=?^_`{|}~\\-";
const SPACED_EMAIL_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9._%+\\-])` +
    `([${EMAIL_LOCAL_CHARACTER_CLASS}]+)` +
    `([ \\u3000]*)@([ \\u3000]*)` +
    `([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)` +
    `(?=$|[^A-Za-z0-9._%+\\-])`,
  "g",
);

export function normalizeForDetection(
  sourceText: string,
  rules: DetectionNormalizationRule[] = DEFAULT_RULES,
): NormalizedTextResult {
  let units = createMappedCodeUnits(sourceText);
  const pendingEvents: PendingNormalizationEvent[] = [];

  for (const rule of rules) {
    switch (rule) {
      case "email_at_spacing": {
        const result = removeEmailAtSpacing(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
    }
  }

  return {
    text: units.map((unit) => unit.value).join(""),
    mappings: units.map(({ originalStart, originalEnd }) => ({
      originalStart,
      originalEnd,
    })),
    appliedRules: pendingEvents.flatMap((event) => {
      const normalizedRange = findNormalizedRange(units, event);

      return normalizedRange
        ? [{ ...event, ...normalizedRange } satisfies NormalizationEvent]
        : [];
    }),
  };
}

function createMappedCodeUnits(sourceText: string): MappedCodeUnit[] {
  return Array.from({ length: sourceText.length }, (_, index) => ({
    value: sourceText[index],
    originalStart: index,
    originalEnd: index + 1,
  }));
}

function removeEmailAtSpacing(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];

  for (const match of text.matchAll(SPACED_EMAIL_PATTERN)) {
    const prefix = match[1] ?? "";
    const localPart = match[2];
    const beforeAt = match[3] ?? "";
    const afterAt = match[4] ?? "";
    const domain = match[5];

    if (!localPart || !domain || (beforeAt.length === 0 && afterAt.length === 0)) {
      continue;
    }

    const candidateStart = match.index + prefix.length;
    const atIndex = candidateStart + localPart.length + beforeAt.length;
    const candidateEnd =
      atIndex + 1 + afterAt.length + domain.length;
    const first = units[candidateStart];
    const last = units[candidateEnd - 1];

    if (!first || !last) {
      continue;
    }

    for (let index = atIndex - beforeAt.length; index < atIndex; index += 1) {
      deletedIndexes.add(index);
    }

    for (
      let index = atIndex + 1;
      index < atIndex + 1 + afterAt.length;
      index += 1
    ) {
      deletedIndexes.add(index);
    }

    events.push({
      rule: "email_at_spacing",
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function findNormalizedRange(
  units: MappedCodeUnit[],
  event: PendingNormalizationEvent,
): { normalizedStart: number; normalizedEnd: number } | undefined {
  const normalizedStart = units.findIndex(
    (unit) =>
      event.originalStart < unit.originalEnd &&
      unit.originalStart < event.originalEnd,
  );

  if (normalizedStart < 0) {
    return undefined;
  }

  let normalizedEnd = normalizedStart;

  while (
    normalizedEnd < units.length &&
    units[normalizedEnd].originalStart < event.originalEnd
  ) {
    normalizedEnd += 1;
  }

  return { normalizedStart, normalizedEnd };
}
