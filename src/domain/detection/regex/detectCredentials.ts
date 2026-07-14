import type { DetectionCandidate } from "../mergeCandidates";
import { uniqueCandidates } from "./common";

const CREDENTIAL_LABEL_PATTERN =
  /(?:ユーザーID|ユーザID|ログインID|アカウントID|ユーザー名|ユーザ名|パスワード|password|ID)/giu;
const MAX_CREDENTIAL_LENGTH = 256;
const QUOTE_PAIRS: Readonly<Record<string, string>> = {
  "「": "」",
  "『": "』",
  '"': '"',
  "'": "'",
  "“": "”",
  "‘": "’",
};

export function detectCredentials(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const match of sourceText.matchAll(CREDENTIAL_LABEL_PATTERN)) {
    const labelStart = match.index;
    const labelEnd = labelStart + match[0].length;

    if (!hasLabelBoundary(sourceText, labelStart, labelEnd)) {
      continue;
    }

    const range = readCredentialRange(sourceText, labelEnd);

    if (!range) {
      continue;
    }

    candidates.push({
      originalText: sourceText.slice(range.start, range.end),
      category: "SECRET",
      source: "regex",
      start: range.start,
      end: range.end,
    });
  }

  return uniqueCandidates(candidates);
}

function hasLabelBoundary(
  sourceText: string,
  start: number,
  end: number,
): boolean {
  const previous = sourceText.slice(Math.max(0, start - 1), start);
  const next = sourceText.slice(end, end + 1);

  return !isAsciiWordCharacter(previous) && !isAsciiWordCharacter(next);
}

function readCredentialRange(
  sourceText: string,
  labelEnd: number,
): { start: number; end: number } | undefined {
  let cursor = labelEnd;
  const whitespaceStart = cursor;
  cursor = skipInlineSpaces(sourceText, cursor);
  const hadWhitespace = cursor > whitespaceStart;
  let hadConnector = false;

  if (
    sourceText[cursor] === "は" ||
    sourceText[cursor] === ":" ||
    sourceText[cursor] === "：" ||
    sourceText[cursor] === "=" ||
    sourceText[cursor] === "＝"
  ) {
    hadConnector = true;
    cursor = skipInlineSpaces(sourceText, cursor + 1);
  }

  const closingQuote = QUOTE_PAIRS[sourceText[cursor]];

  if (closingQuote) {
    return readQuotedRange(sourceText, cursor, closingQuote);
  }

  if (!hadConnector && !hadWhitespace) {
    return undefined;
  }

  return readUnquotedRange(sourceText, cursor);
}

function readQuotedRange(
  sourceText: string,
  openingQuoteIndex: number,
  closingQuote: string,
): { start: number; end: number } | undefined {
  const start = openingQuoteIndex + 1;
  const end = sourceText.indexOf(closingQuote, start);

  if (end < 0) {
    return undefined;
  }

  const value = sourceText.slice(start, end);

  if (
    value.trim().length === 0 ||
    value.length > MAX_CREDENTIAL_LENGTH ||
    /[\r\n]/u.test(value)
  ) {
    return undefined;
  }

  return { start, end };
}

function readUnquotedRange(
  sourceText: string,
  start: number,
): { start: number; end: number } | undefined {
  let end = start;

  while (end < sourceText.length && isVisibleAscii(sourceText[end])) {
    end += 1;
  }

  const value = sourceText.slice(start, end);

  if (value.length === 0 || value.length > MAX_CREDENTIAL_LENGTH) {
    return undefined;
  }

  return { start, end };
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

function isAsciiWordCharacter(value: string): boolean {
  return /^[A-Za-z0-9_]$/u.test(value);
}

function isVisibleAscii(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  const codePoint = value.charCodeAt(0);

  return codePoint >= 0x21 && codePoint <= 0x7e;
}
