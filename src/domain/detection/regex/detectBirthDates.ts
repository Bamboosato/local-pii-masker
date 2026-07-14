import type { DetectionCandidate } from "../mergeCandidates";
import { extractAsciiDigits, uniqueCandidates } from "./common";

const BIRTH_DATE_LABEL_PATTERN = /(?:生年月日|誕生日|生まれた日|DOB)/giu;
const ERA_DATE_PATTERN =
  /^(明治|大正|昭和|平成|令和)(元|[0-9０-９]{1,2})年([0-9０-９]{1,2})月([0-9０-９]{1,2})日/u;
const JAPANESE_DATE_PATTERN =
  /^([0-9０-９]{4})年([0-9０-９]{1,2})月([0-9０-９]{1,2})日/u;
const SEPARATED_DATE_PATTERN =
  /^([0-9０-９]{4})([-－/／.．])([0-9０-９]{1,2})\2([0-9０-９]{1,2})/u;
const DIGIT_PATTERN = /^[0-9０-９]$/u;
const QUOTE_PAIRS: Readonly<Record<string, string>> = {
  "「": "」",
  "『": "』",
  '"': '"',
  "'": "'",
  "“": "”",
  "‘": "’",
};

type EraName = "明治" | "大正" | "昭和" | "平成" | "令和";

const ERA_RANGES: Readonly<
  Record<
    EraName,
    {
      baseYear: number;
      start: number;
      end?: number;
    }
  >
> = {
  明治: { baseYear: 1867, start: 18680125, end: 19120729 },
  大正: { baseYear: 1911, start: 19120730, end: 19261224 },
  昭和: { baseYear: 1925, start: 19261225, end: 19890107 },
  平成: { baseYear: 1988, start: 19890108, end: 20190430 },
  令和: { baseYear: 2018, start: 20190501 },
};

export function detectBirthDates(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const labelMatch of sourceText.matchAll(BIRTH_DATE_LABEL_PATTERN)) {
    const labelStart = labelMatch.index;
    const labelEnd = labelStart + labelMatch[0].length;

    if (!hasLabelBoundary(sourceText, labelStart, labelEnd, labelMatch[0])) {
      continue;
    }

    const range = readBirthDateRange(sourceText, labelEnd);

    if (!range) {
      continue;
    }

    candidates.push({
      originalText: sourceText.slice(range.start, range.end),
      category: "OTHER",
      source: "regex",
      start: range.start,
      end: range.end,
    });
  }

  return uniqueCandidates(candidates);
}

function readBirthDateRange(
  sourceText: string,
  labelEnd: number,
): { start: number; end: number } | undefined {
  let cursor = skipInlineSpaces(sourceText, labelEnd);

  if (
    sourceText[cursor] === "は" ||
    sourceText[cursor] === ":" ||
    sourceText[cursor] === "：" ||
    sourceText[cursor] === "=" ||
    sourceText[cursor] === "＝"
  ) {
    cursor = skipInlineSpaces(sourceText, cursor + 1);
  }

  const closingQuote = QUOTE_PAIRS[sourceText[cursor]];

  if (closingQuote) {
    cursor += 1;
  }

  const matchedValue = matchBirthDate(sourceText.slice(cursor));

  if (!matchedValue) {
    return undefined;
  }

  const end = cursor + matchedValue.length;

  if (DIGIT_PATTERN.test(sourceText[end] ?? "")) {
    return undefined;
  }

  if (closingQuote && sourceText[end] !== closingQuote) {
    return undefined;
  }

  return { start: cursor, end };
}

function matchBirthDate(value: string): string | undefined {
  const eraMatch = value.match(ERA_DATE_PATTERN);

  if (eraMatch) {
    const era = eraMatch[1] as EraName;
    const eraYear = eraMatch[2] === "元" ? 1 : toNumber(eraMatch[2]);
    const month = toNumber(eraMatch[3]);
    const day = toNumber(eraMatch[4]);

    if (isValidEraDate(era, eraYear, month, day)) {
      return eraMatch[0];
    }
  }

  const japaneseMatch = value.match(JAPANESE_DATE_PATTERN);

  if (japaneseMatch) {
    const year = toNumber(japaneseMatch[1]);
    const month = toNumber(japaneseMatch[2]);
    const day = toNumber(japaneseMatch[3]);

    if (isValidDate(year, month, day)) {
      return japaneseMatch[0];
    }
  }

  const separatedMatch = value.match(SEPARATED_DATE_PATTERN);

  if (separatedMatch) {
    const year = toNumber(separatedMatch[1]);
    const month = toNumber(separatedMatch[3]);
    const day = toNumber(separatedMatch[4]);

    if (isValidDate(year, month, day)) {
      return separatedMatch[0];
    }
  }

  return undefined;
}

function isValidEraDate(
  era: EraName,
  eraYear: number,
  month: number,
  day: number,
): boolean {
  if (eraYear < 1) {
    return false;
  }

  const range = ERA_RANGES[era];
  const year = range.baseYear + eraYear;

  if (!isValidDate(year, month, day)) {
    return false;
  }

  const comparableDate = year * 10000 + month * 100 + day;

  return (
    comparableDate >= range.start &&
    (range.end === undefined || comparableDate <= range.end)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function toNumber(value: string): number {
  return Number(extractAsciiDigits(value));
}

function skipInlineSpaces(sourceText: string, start: number): number {
  let cursor = start;

  while (
    sourceText[cursor] === " " ||
    sourceText[cursor] === "\t" ||
    sourceText[cursor] === "\u3000"
  ) {
    cursor += 1;
  }

  return cursor;
}

function hasLabelBoundary(
  sourceText: string,
  start: number,
  end: number,
  label: string,
): boolean {
  if (!/^[A-Za-z]+$/u.test(label)) {
    return true;
  }

  const previous = sourceText.slice(Math.max(0, start - 1), start);
  const next = sourceText.slice(end, end + 1);

  return !/[A-Za-z0-9_]/u.test(previous) && !/[A-Za-z0-9_]/u.test(next);
}
