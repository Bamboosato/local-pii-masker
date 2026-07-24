import type {
  DetectionNormalizationRule,
  NormalizationEvent,
  NormalizedTextResult,
} from "./types";
import { createJapaneseAddressPattern } from "../../reference/japaneseAddresses";
import {
  COMMON_JAPANESE_SURNAMES,
  createSurnamePatternWithOptionalSpacing,
} from "../../reference/japanesePersonNames";

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
const EMAIL_LOCAL_ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~]+";
const EMAIL_DOMAIN_LABEL = "[A-Za-z0-9-]+";
const LINE_BREAK_WITH_SPACING = "[ \\u3000]*\\r?\\n[ \\u3000]*";
const OPTIONAL_LINE_BREAK = `(?:${LINE_BREAK_WITH_SPACING})?`;
const PHONE_HYPHEN_CHARACTER_CLASS = "\\-‐‑‒–—―－ーｰ";
const STRUCTURED_EMAIL_LOCAL =
  `${EMAIL_LOCAL_ATOM}` +
  `(?:${OPTIONAL_LINE_BREAK}[.-]${OPTIONAL_LINE_BREAK}${EMAIL_LOCAL_ATOM})+`;
const EMAIL_DOMAIN_LABEL_WITH_HYPHEN_BREAK =
  `[A-Za-z0-9]+(?:-${OPTIONAL_LINE_BREAK}[A-Za-z0-9]+)*`;
const SPACED_EMAIL_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9._%+\\-])` +
    `([${EMAIL_LOCAL_CHARACTER_CLASS}]+)` +
    `([ \\u3000]*)@([ \\u3000]*)` +
    `([A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+)` +
    `(?=$|[^A-Za-z0-9._%+\\-])`,
  "g",
);
const LINE_BROKEN_EMAIL_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9._%+\\-])` +
    `([${EMAIL_LOCAL_CHARACTER_CLASS}]+)` +
    `${OPTIONAL_LINE_BREAK}@${OPTIONAL_LINE_BREAK}` +
    `(${EMAIL_DOMAIN_LABEL_WITH_HYPHEN_BREAK}` +
    `(?:${OPTIONAL_LINE_BREAK}\\.${OPTIONAL_LINE_BREAK}${EMAIL_DOMAIN_LABEL_WITH_HYPHEN_BREAK})+)` +
    `(?=$|[^A-Za-z0-9._%+\\-])`,
  "g",
);
const STRUCTURED_LOCAL_LINE_BROKEN_EMAIL_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9._%+\\-])` +
    `(${STRUCTURED_EMAIL_LOCAL})` +
    `${OPTIONAL_LINE_BREAK}@${OPTIONAL_LINE_BREAK}` +
    `(${EMAIL_DOMAIN_LABEL}(?:${OPTIONAL_LINE_BREAK}\\.${OPTIONAL_LINE_BREAK}${EMAIL_DOMAIN_LABEL})+)` +
    `(?=$|[^A-Za-z0-9._%+\\-])`,
  "g",
);
const EMAIL_LINE_BREAK_PATTERNS = [
  LINE_BROKEN_EMAIL_PATTERN,
  STRUCTURED_LOCAL_LINE_BROKEN_EMAIL_PATTERN,
];
const LINE_BREAK_WITH_SPACING_PATTERN = new RegExp(
  LINE_BREAK_WITH_SPACING,
  "g",
);
const HYPHEN_VARIANTS = new Set(["−", "ー", "―", "‐", "–", "—", "‑", "‒"]);
const URL_CHARACTER_PATTERN = /^[A-Za-z0-9._~:/?@!$&*+,;=%#-]$/;
const URL_STRUCTURE_CHARACTERS = new Set([".", "/", "?", "&", "=", "#"]);
const URL_BEFORE_LINE_BREAK_PATTERN =
  /(?:^|[^A-Za-z0-9._~:/?@!$&*+,;=%#-])(https?:\/\/[A-Za-z0-9._~:/?@!$&*+,;=%#-]*)$/i;
const PERSON_NAME_LEFT_PATTERN =
  /(?:^|[ \u3000:：「『（(])([一-龥々]{1,3})$/u;
const PERSON_NAME_RIGHT_PATTERN = /^([一-龥々]{1,3})(?=$|[^一-龥々])/u;
const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}(?:\s|$)/u;
const MARKDOWN_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/u;
const PERSON_FIELD_LABEL_LINE_PATTERN =
  /^\s*(?:氏名|名前|姓|名字|苗字|名義人|担当者?|責任者|患者氏名|申請者)[ \u3000]*(?:[:：=]|$)/u;
const JAPANESE_NAME_CHARACTER_CLASS = "一-龥々ァ-ヶー";
const JAPANESE_INTER_CHARACTER_SPACING_PATTERN = new RegExp(
  `(^|[^${JAPANESE_NAME_CHARACTER_CLASS}])` +
    `((?:[${JAPANESE_NAME_CHARACTER_CLASS}][ \\u3000]){2,6}` +
    `[${JAPANESE_NAME_CHARACTER_CLASS}])` +
    `(?=$|[^${JAPANESE_NAME_CHARACTER_CLASS}])`,
  "gu",
);
const COMMON_SURNAME_WITH_OPTIONAL_SPACING =
  createSurnamePatternWithOptionalSpacing(COMMON_JAPANESE_SURNAMES);
const COMPLETED_PERSON_NAME_LINE_PATTERN = new RegExp(
  `(?:${COMMON_SURNAME_WITH_OPTIONAL_SPACING})[一-龥々]{2,4}$`,
  "u",
);
const PERSON_NAME_STRONG_LEFT_PATTERN = new RegExp(
  `((?:${COMMON_SURNAME_WITH_OPTIONAL_SPACING})[一-龥々]{1,2})$`,
  "u",
);
const PARTIALLY_SPACED_KANJI_NAME_PATTERN = new RegExp(
  `(^|[^一-龥々])` +
    `((?:${COMMON_SURNAME_WITH_OPTIONAL_SPACING})[ \\u3000]?[一-龥々]` +
    `(?:[ \\u3000]?[一-龥々])?)` +
    `(?=$|[^一-龥々])`,
  "gu",
);
const JAPANESE_CHARACTER_BEFORE_SPACED_SEQUENCE = new RegExp(
  `[${JAPANESE_NAME_CHARACTER_CLASS}][ \\u3000\\t]*$`,
  "u",
);
const JAPANESE_CHARACTER_AFTER_SPACED_SEQUENCE = new RegExp(
  `^[ \\u3000\\t]*[${JAPANESE_NAME_CHARACTER_CLASS}]`,
  "u",
);
const LINE_BROKEN_JAPANESE_ADDRESS_PATTERN = createJapaneseAddressPattern(
  LINE_BREAK_WITH_SPACING,
);
const ORGANIZATION_PREFIX_PATTERN =
  "株式会社|有限会社|合同会社|合資会社|合名会社|学校法人|医療法人|社会福祉法人|一般社団法人|一般財団法人";
const ORGANIZATION_CHARACTER_CLASS = "一-龥々ぁ-ゖァ-ヶーA-Za-z0-9０-９・&＆._";
const ORGANIZATION_INDICATOR_PATTERN = new RegExp(
  `(?:${ORGANIZATION_PREFIX_PATTERN}|会社|法人|協会|組合|銀行|病院|大学|` +
    "センター|システム|メディカル)",
  "u",
);
const ORGANIZATION_TRAILING_CONTEXT_PATTERN =
  /[ \u3000]*(?:ですので|でした|である|です|など|等)$/u;
const ORGANIZATION_PREFIX_ONLY_PATTERN = new RegExp(
  `^(?:${ORGANIZATION_PREFIX_PATTERN})$`,
  "u",
);
const LINE_BROKEN_ORGANIZATION_PATTERN = new RegExp(
  `(^|[^${ORGANIZATION_CHARACTER_CLASS}])` +
    `([${ORGANIZATION_CHARACTER_CLASS}]{2,}(?:${LINE_BREAK_WITH_SPACING}` +
    `[${ORGANIZATION_CHARACTER_CLASS}]{1,}){1,2})` +
    `(?=$|[^${ORGANIZATION_CHARACTER_CLASS}])`,
  "gu",
);
const PHONE_SEPARATOR_WITH_OPTIONAL_LINE_BREAK =
  `[ \\u3000]*${OPTIONAL_LINE_BREAK}[${PHONE_HYPHEN_CHARACTER_CLASS}][ \\u3000]*${OPTIONAL_LINE_BREAK}`;
const LINE_BROKEN_PHONE_PATTERN = new RegExp(
  `(^|[^0-9０-９A-Za-zＡ-Ｚａ-ｚ\\-‐‑‒–—―－ーｰ])` +
    `([0０][0-9０-９]{1,4}${PHONE_SEPARATOR_WITH_OPTIONAL_LINE_BREAK}` +
    `[0-9０-９]{1,4}${PHONE_SEPARATOR_WITH_OPTIONAL_LINE_BREAK}` +
    `[0-9０-９]{3,4})` +
    `(?=$|[^0-9０-９A-Za-zＡ-Ｚａ-ｚ\\-‐‑‒–—―－ーｰ])`,
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
      case "fullwidth_ascii": {
        const result = replaceCharacters(units, rule, toAsciiFromFullwidth);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "hyphen_variants": {
        const result = replaceCharacters(units, rule, (value) =>
          HYPHEN_VARIANTS.has(value) ? "-" : value,
        );
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "email_at_spacing": {
        const result = removeEmailAtSpacing(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "email_line_break": {
        const result = removeEmailLineBreaks(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "url_line_break": {
        const result = removeUrlLineBreaks(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "address_line_break": {
        const result = removeAddressLineBreaks(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "person_name_line_break": {
        const result = removePersonNameLineBreaks(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "phone_line_break": {
        const result = removePhoneLineBreaks(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "organization_line_break": {
        const result = removeOrganizationLineBreaks(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "japanese_inter_character_space": {
        const result = removeJapaneseInterCharacterSpaces(units);
        units = result.units;
        pendingEvents.push(...result.events);
        break;
      }
      case "line_end_hyphen":
        break;
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

function replaceCharacters(
  units: MappedCodeUnit[],
  rule: DetectionNormalizationRule,
  replace: (value: string) => string,
): { units: MappedCodeUnit[]; events: PendingNormalizationEvent[] } {
  const events: PendingNormalizationEvent[] = [];
  const nextUnits = units.map((unit) => {
    const value = replace(unit.value);

    if (value === unit.value) {
      return unit;
    }

    events.push({
      rule,
      originalStart: unit.originalStart,
      originalEnd: unit.originalEnd,
    });

    return { ...unit, value };
  });

  return { units: nextUnits, events };
}

function toAsciiFromFullwidth(value: string): string {
  const codePoint = value.codePointAt(0);

  if (codePoint === undefined || codePoint < 0xff01 || codePoint > 0xff5e) {
    return value;
  }

  return String.fromCodePoint(codePoint - 0xfee0);
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

function removeEmailLineBreaks(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];
  const seenCandidates = new Set<string>();

  for (const pattern of EMAIL_LINE_BREAK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const prefix = match[1] ?? "";
      const candidateStart = match.index + prefix.length;
      const candidateText = match[0].slice(prefix.length);

      if (!candidateText.includes("\n")) {
        continue;
      }

      const candidateEnd = candidateStart + candidateText.length;
      const candidateKey = `${candidateStart}:${candidateEnd}`;
      const first = units[candidateStart];
      const last = units[candidateEnd - 1];

      if (seenCandidates.has(candidateKey) || !first || !last) {
        continue;
      }

      const lineBreaks = [
        ...candidateText.matchAll(LINE_BREAK_WITH_SPACING_PATTERN),
      ];

      for (const lineBreak of lineBreaks) {
        const start = candidateStart + lineBreak.index;

        for (let index = start; index < start + lineBreak[0].length; index += 1) {
          deletedIndexes.add(index);
        }
      }

      events.push({
        rule: "email_line_break",
        originalStart: first.originalStart,
        originalEnd: last.originalEnd,
      });

      if (
        lineBreaks.some((lineBreak) =>
          hasLineEndHyphen(candidateText, lineBreak),
        )
      ) {
        events.push({
          rule: "line_end_hyphen",
          originalStart: first.originalStart,
          originalEnd: last.originalEnd,
        });
      }

      seenCandidates.add(candidateKey);
    }
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function removeUrlLineBreaks(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  let nextUnits = units;
  const events: PendingNormalizationEvent[] = [];

  while (true) {
    const text = nextUnits.map((unit) => unit.value).join("");
    const lineBreaks = [...text.matchAll(LINE_BREAK_WITH_SPACING_PATTERN)];
    let removed = false;

    for (const lineBreak of lineBreaks) {
      const start = lineBreak.index;
      const end = start + lineBreak[0].length;
      const left = text[start - 1];
      const right = text[end];

      if (
        !left ||
        !right ||
        !URL_CHARACTER_PATTERN.test(left) ||
        !URL_CHARACTER_PATTERN.test(right) ||
        (!URL_STRUCTURE_CHARACTERS.has(left) &&
          !URL_STRUCTURE_CHARACTERS.has(right) &&
          left !== "-")
      ) {
        continue;
      }

      const beforeMatch = text.slice(0, start).match(URL_BEFORE_LINE_BREAK_PATTERN);
      const urlBeforeBreak = beforeMatch?.[1];

      if (!urlBeforeBreak) {
        continue;
      }

      const urlStart = start - urlBeforeBreak.length;
      let continuationEnd = end;

      while (
        continuationEnd < text.length &&
        URL_CHARACTER_PATTERN.test(text[continuationEnd])
      ) {
        continuationEnd += 1;
      }

      const first = nextUnits[urlStart];
      const last = nextUnits[continuationEnd - 1];

      if (!first || !last) {
        continue;
      }

      events.push({
        rule: "url_line_break",
        originalStart: first.originalStart,
        originalEnd: last.originalEnd,
      });
      if (left === "-") {
        events.push({
          rule: "line_end_hyphen",
          originalStart: first.originalStart,
          originalEnd: last.originalEnd,
        });
      }
      nextUnits = nextUnits.filter((_, index) => index < start || index >= end);
      removed = true;
      break;
    }

    if (!removed) {
      return { units: nextUnits, events };
    }
  }
}

function removePhoneLineBreaks(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];

  for (const match of text.matchAll(LINE_BROKEN_PHONE_PATTERN)) {
    const prefix = match[1] ?? "";
    const candidateText = match[0].slice(prefix.length);

    if (!candidateText.includes("\n") && !candidateText.includes("\r")) {
      continue;
    }

    const candidateStart = match.index + prefix.length;
    const candidateEnd = candidateStart + candidateText.length;
    const first = units[candidateStart];
    const last = units[candidateEnd - 1];

    if (!first || !last) {
      continue;
    }

    for (const lineBreak of candidateText.matchAll(
      LINE_BREAK_WITH_SPACING_PATTERN,
    )) {
      const start = candidateStart + lineBreak.index;

      for (let index = start; index < start + lineBreak[0].length; index += 1) {
        deletedIndexes.add(index);
      }
    }

    events.push({
      rule: "phone_line_break",
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function removeOrganizationLineBreaks(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const protectedRanges = findMarkdownCodeFenceRanges(text);
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];

  for (const match of text.matchAll(LINE_BROKEN_ORGANIZATION_PATTERN)) {
    const prefix = match[1] ?? "";
    const matchedCandidateText = match[0].slice(prefix.length);
    const candidateText = matchedCandidateText.replace(
      ORGANIZATION_TRAILING_CONTEXT_PATTERN,
      "",
    );

    if (!candidateText.includes("\n") && !candidateText.includes("\r")) {
      continue;
    }

    const candidateStart = match.index + prefix.length;
    const candidateEnd = candidateStart + candidateText.length;
    const firstLineStart = text.lastIndexOf("\n", candidateStart - 1) + 1;
    const firstLineEnd = text.indexOf("\n", candidateStart);
    const firstLine = text.slice(
      firstLineStart,
      firstLineEnd >= 0 ? firstLineEnd : text.length,
    );
    const first = units[candidateStart];
    const last = units[candidateEnd - 1];
    const organizationText = candidateText.replace(
      LINE_BREAK_WITH_SPACING_PATTERN,
      "",
    );
    const organizationSegments = candidateText
      .split(/\r?\n/u)
      .map((segment) => segment.trim())
      .filter(Boolean);
    const hasStandaloneOrganizationPrefix = ORGANIZATION_PREFIX_ONLY_PATTERN.test(
      organizationSegments[0] ?? "",
    );
    const hasShortContinuation = organizationSegments
      .slice(1)
      .some((segment) => segment.length <= 3);

    if (
      !first ||
      !last ||
      !ORGANIZATION_INDICATOR_PATTERN.test(organizationText) ||
      (!hasStandaloneOrganizationPrefix && !hasShortContinuation) ||
      MARKDOWN_HEADING_PATTERN.test(firstLine) ||
      isInsideRange(protectedRanges, candidateStart) ||
      isInsideRange(protectedRanges, candidateEnd - 1)
    ) {
      continue;
    }

    for (const lineBreak of candidateText.matchAll(
      LINE_BREAK_WITH_SPACING_PATTERN,
    )) {
      const start = candidateStart + lineBreak.index;

      for (let index = start; index < start + lineBreak[0].length; index += 1) {
        deletedIndexes.add(index);
      }
    }

    events.push({
      rule: "organization_line_break",
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function removeAddressLineBreaks(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const protectedRanges = findMarkdownCodeFenceRanges(text);
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];

  for (const match of text.matchAll(LINE_BROKEN_JAPANESE_ADDRESS_PATTERN)) {
    const prefix = match[1] ?? "";
    const candidateText = match[2];

    if (!candidateText?.includes("\n")) {
      continue;
    }

    const candidateStart = match.index + prefix.length;
    const candidateEnd = candidateStart + candidateText.length;
    const firstLineStart = text.lastIndexOf("\n", candidateStart - 1) + 1;
    const firstLineEnd = text.indexOf("\n", candidateStart);
    const firstLine = text.slice(
      firstLineStart,
      firstLineEnd >= 0 ? firstLineEnd : text.length,
    );
    const first = units[candidateStart];
    const last = units[candidateEnd - 1];

    if (
      !first ||
      !last ||
      MARKDOWN_HEADING_PATTERN.test(firstLine) ||
      isInsideRange(protectedRanges, candidateStart) ||
      isInsideRange(protectedRanges, candidateEnd - 1)
    ) {
      continue;
    }

    for (const lineBreak of candidateText.matchAll(
      LINE_BREAK_WITH_SPACING_PATTERN,
    )) {
      const start = candidateStart + lineBreak.index;

      for (let index = start; index < start + lineBreak[0].length; index += 1) {
        deletedIndexes.add(index);
      }
    }

    events.push({
      rule: "address_line_break",
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function hasLineEndHyphen(
  candidateText: string,
  lineBreak: RegExpMatchArray,
): boolean {
  return candidateText.slice(0, lineBreak.index).trimEnd().endsWith("-");
}

function removePersonNameLineBreaks(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const protectedRanges = findMarkdownCodeFenceRanges(text);
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];

  for (const lineBreak of text.matchAll(LINE_BREAK_WITH_SPACING_PATTERN)) {
    const start = lineBreak.index;
    const end = start + lineBreak[0].length;
    const leftLineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLineBreak = text.indexOf("\n", end);
    const rightLineEnd = nextLineBreak >= 0 ? nextLineBreak : text.length;
    const leftLine = text.slice(leftLineStart, start);
    const rightLine = text.slice(end, rightLineEnd).replace(/\r$/u, "");

    if (
      isInsideRange(protectedRanges, start) ||
      isInsideRange(protectedRanges, end) ||
      MARKDOWN_HEADING_PATTERN.test(leftLine) ||
      MARKDOWN_HEADING_PATTERN.test(rightLine) ||
      PERSON_FIELD_LABEL_LINE_PATTERN.test(rightLine)
    ) {
      continue;
    }

    const contextualLeftName = leftLine.match(PERSON_NAME_LEFT_PATTERN)?.[1];
    const strongLeftName = leftLine.match(PERSON_NAME_STRONG_LEFT_PATTERN)?.[1];
    const leftName = contextualLeftName ?? strongLeftName;
    const rightName = rightLine.match(PERSON_NAME_RIGHT_PATTERN)?.[1];

    if (!leftName || !rightName) {
      continue;
    }

    // A complete name at the end of the left line is already a valid
    // candidate. Do not join the next line into it (for example,
    // "佐藤 太郎\\n佐藤"), which would turn two adjacent names into one.
    if (COMPLETED_PERSON_NAME_LINE_PATTERN.test(leftLine.trimEnd())) {
      continue;
    }

    if (
      !contextualLeftName &&
      (leftName.length + rightName.length < 4 ||
        leftName.length + rightName.length > 5)
    ) {
      continue;
    }

    const candidateStart = start - leftName.length;
    const candidateEnd = end + rightName.length;
    const first = units[candidateStart];
    const last = units[candidateEnd - 1];

    if (!first || !last) {
      continue;
    }

    for (let index = start; index < end; index += 1) {
      deletedIndexes.add(index);
    }

    events.push({
      rule: "person_name_line_break",
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function removeJapaneseInterCharacterSpaces(units: MappedCodeUnit[]): {
  units: MappedCodeUnit[];
  events: PendingNormalizationEvent[];
} {
  const text = units.map((unit) => unit.value).join("");
  const deletedIndexes = new Set<number>();
  const events: PendingNormalizationEvent[] = [];

  for (const { start: candidateStart, end: candidateEnd } of uniqueRanges([
    ...findSpacedJapaneseRanges(
      text,
      JAPANESE_INTER_CHARACTER_SPACING_PATTERN,
    ),
    ...findSpacedJapaneseRanges(text, PARTIALLY_SPACED_KANJI_NAME_PATTERN),
  ])) {

    if (
      JAPANESE_CHARACTER_BEFORE_SPACED_SEQUENCE.test(
        text.slice(0, candidateStart),
      ) ||
      JAPANESE_CHARACTER_AFTER_SPACED_SEQUENCE.test(text.slice(candidateEnd))
    ) {
      continue;
    }

    const first = units[candidateStart];
    const last = units[candidateEnd - 1];

    if (!first || !last) {
      continue;
    }

    for (let index = candidateStart; index < candidateEnd; index += 1) {
      if (units[index]?.value === " " || units[index]?.value === "　") {
        deletedIndexes.add(index);
      }
    }

    events.push({
      rule: "japanese_inter_character_space",
      originalStart: first.originalStart,
      originalEnd: last.originalEnd,
    });
  }

  return {
    units: units.filter((_, index) => !deletedIndexes.has(index)),
    events,
  };
}

function findSpacedJapaneseRanges(
  text: string,
  pattern: RegExp,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? "";
    const candidateText = match[2];

    if (!candidateText || countJapaneseSpaces(candidateText) < 2) {
      continue;
    }

    const start = match.index + prefix.length;
    const end = start + candidateText.length;

    if (
      JAPANESE_CHARACTER_BEFORE_SPACED_SEQUENCE.test(text.slice(0, start)) ||
      JAPANESE_CHARACTER_AFTER_SPACED_SEQUENCE.test(text.slice(end))
    ) {
      continue;
    }

    ranges.push({ start, end });
  }

  return ranges;
}

function countJapaneseSpaces(value: string): number {
  return [...value].filter((character) => character === " " || character === "　")
    .length;
}

function uniqueRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  return [
    ...new Map(ranges.map((range) => [`${range.start}:${range.end}`, range])).values(),
  ];
}

function findMarkdownCodeFenceRanges(
  text: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let fenceMarker: "`" | "~" | undefined;
  let lineStart = 0;

  while (lineStart < text.length) {
    const newlineIndex = text.indexOf("\n", lineStart);
    const lineEnd = newlineIndex >= 0 ? newlineIndex + 1 : text.length;
    const line = text.slice(lineStart, newlineIndex >= 0 ? newlineIndex : text.length);
    const fence = line.match(MARKDOWN_FENCE_PATTERN)?.[1];
    const marker = fence?.[0] as "`" | "~" | undefined;
    const isFenceLine = marker !== undefined && (!fenceMarker || marker === fenceMarker);

    if (fenceMarker || isFenceLine) {
      ranges.push({ start: lineStart, end: lineEnd });
    }

    if (isFenceLine) {
      fenceMarker = fenceMarker ? undefined : marker;
    }

    lineStart = lineEnd;
  }

  return ranges;
}

function isInsideRange(
  ranges: Array<{ start: number; end: number }>,
  position: number,
): boolean {
  return ranges.some(
    (range) => range.start <= position && position < range.end,
  );
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
