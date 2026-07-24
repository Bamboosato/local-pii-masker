import type { DetectionCandidate } from "../mergeCandidates";
import { createRegexCandidate, uniqueCandidates } from "./common";
import {
  COMMON_JAPANESE_SURNAMES_PATTERN,
  extendOcrSpacedGivenNameEnd,
} from "./personNamePatterns";

const PERSON_FIELD_NAMES = new Set([
  "氏名",
  "名前",
  "名義人",
  "司会",
  "記録",
  "担当",
  "担当者",
  "責任者",
  "開発者",
  "設計者",
  "管理者",
  "name",
  "fullname",
  "owner",
  "reviewer",
  "developer",
  "designer",
  "manager",
  "assignee",
  "author",
]);
const JAPANESE_NAME_PATTERN = new RegExp(
  `(?:${COMMON_JAPANESE_SURNAMES_PATTERN})[ \u3000]*[一-龥々]{1,4}`,
  "gu",
);
const ENGLISH_NAME_PATTERN =
  /(?:[A-Z][a-z]+|[A-Z]{2,})(?:[ \u3000]+(?:[A-Z][a-z]+|[A-Z]{2,})){1,3}/gu;
const JAPANESE_LETTER_PATTERN = /[一-龥々ぁ-んァ-ヶー]/u;
const ASCII_LETTER_PATTERN = /[A-Za-z]/u;
const FENCED_BLOCK_PATTERN =
  /```([A-Za-z0-9_-]*)[^\r\n]*\r?\n([\s\S]*?)\r?\n```/gu;
const JSON_STRING_FIELD_PATTERN =
  /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gu;

type SourceLine = {
  start: number;
  text: string;
};

type SourceRange = {
  end: number;
  start: number;
  value: string;
};

type FencedBlock = {
  body: string;
  bodyStart: number;
  language: string;
};

export function detectStructuredPersonNames(
  sourceText: string,
): DetectionCandidate[] {
  return uniqueCandidates([
    ...detectKeyValueNames(sourceText),
    ...detectMarkdownTableNames(sourceText),
    ...detectFencedDataNames(sourceText),
  ]);
}

function detectKeyValueNames(sourceText: string): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const line of getSourceLines(sourceText)) {
    const match = line.text.match(
      /^\s*([一-龥々ぁ-んァ-ヶーA-Za-z][^:：=|]{0,31})\s*[:：=]\s*(.+?)\s*$/u,
    );

    if (!match || !isPersonFieldName(match[1])) {
      continue;
    }

    const valueStart = line.start + line.text.indexOf(match[2]);
    candidates.push(
      ...detectNamesInRange(sourceText, valueStart, valueStart + match[2].length),
    );
  }

  return candidates;
}

function detectMarkdownTableNames(
  sourceText: string,
): DetectionCandidate[] {
  const lines = getSourceLines(sourceText);
  const candidates: DetectionCandidate[] = [];

  for (let index = 0; index < lines.length - 2; index += 1) {
    const headerCells = splitMarkdownCells(lines[index]);
    const separatorCells = splitMarkdownCells(lines[index + 1]);
    const personColumnIndex = headerCells.findIndex((cell) =>
      isPersonFieldName(cell.value),
    );

    if (
      personColumnIndex < 0 ||
      separatorCells.length !== headerCells.length ||
      !separatorCells.every((cell) => /^:?-{3,}:?$/u.test(cell.value))
    ) {
      continue;
    }

    let rowIndex = index + 2;

    for (; rowIndex < lines.length; rowIndex += 1) {
      const rowCells = splitMarkdownCells(lines[rowIndex]);

      if (rowCells.length !== headerCells.length) {
        break;
      }

      const personCell = rowCells[personColumnIndex];
      candidates.push(
        ...detectNamesInRange(sourceText, personCell.start, personCell.end),
      );
    }

    index = rowIndex - 1;
  }

  return candidates;
}

function detectFencedDataNames(
  sourceText: string,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];

  for (const block of findFencedBlocks(sourceText)) {
    if (block.language === "json") {
      candidates.push(...detectJsonFieldNames(sourceText, block));
    } else if (block.language === "csv" || block.language === "tsv") {
      candidates.push(...detectDelimitedFieldNames(sourceText, block));
    }
  }

  return candidates;
}

function detectJsonFieldNames(
  sourceText: string,
  block: FencedBlock,
): DetectionCandidate[] {
  if (!isValidJson(block.body)) {
    return [];
  }

  const candidates: DetectionCandidate[] = [];

  for (const match of block.body.matchAll(JSON_STRING_FIELD_PATTERN)) {
    const key = decodeJsonString(match[1]);

    if (!key || !isPersonFieldName(key)) {
      continue;
    }

    const rawValue = match[2];
    const valueOffset = match[0].lastIndexOf(rawValue);
    const valueStart = block.bodyStart + match.index + valueOffset;
    candidates.push(
      ...detectNamesInRange(sourceText, valueStart, valueStart + rawValue.length),
    );
  }

  return candidates;
}

function detectDelimitedFieldNames(
  sourceText: string,
  block: FencedBlock,
): DetectionCandidate[] {
  const lines = getSourceLines(block.body, block.bodyStart).filter(
    (line) => line.text.trim().length > 0,
  );

  if (lines.length < 2) {
    return [];
  }

  const delimiter = block.language === "tsv" ? "\t" : ",";
  const headerCells = splitDelimitedCells(lines[0], delimiter);
  const personColumnIndexes = headerCells
    .map((cell, index) => (isPersonFieldName(cell.value) ? index : -1))
    .filter((index) => index >= 0);

  if (personColumnIndexes.length === 0) {
    return [];
  }

  const candidates: DetectionCandidate[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitDelimitedCells(line, delimiter);

    for (const columnIndex of personColumnIndexes) {
      const cell = cells[columnIndex];

      if (cell) {
        candidates.push(...detectNamesInRange(sourceText, cell.start, cell.end));
      }
    }
  }

  return candidates;
}

function detectNamesInRange(
  sourceText: string,
  start: number,
  end: number,
): DetectionCandidate[] {
  const rangeText = sourceText.slice(start, end);
  const candidates: DetectionCandidate[] = [];

  for (const pattern of [JAPANESE_NAME_PATTERN, ENGLISH_NAME_PATTERN]) {
    for (const match of rangeText.matchAll(pattern)) {
      const candidateStart = start + match.index;
      const matchedEnd = candidateStart + match[0].length;
      const candidateEnd =
        pattern === JAPANESE_NAME_PATTERN
          ? extendOcrSpacedGivenNameEnd(
              sourceText,
              candidateStart,
              matchedEnd,
              end,
            )
          : matchedEnd;
      const before = sourceText[candidateStart - 1];
      const after = sourceText[candidateEnd];
      const boundaryPattern = pattern === JAPANESE_NAME_PATTERN
        ? JAPANESE_LETTER_PATTERN
        : ASCII_LETTER_PATTERN;

      if (
        (before && boundaryPattern.test(before)) ||
        (after && boundaryPattern.test(after))
      ) {
        continue;
      }

      const candidate = createRegexCandidate({
        category: "PERSON",
        sourceText,
        start: candidateStart,
        end: candidateEnd,
      });

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function findFencedBlocks(sourceText: string): FencedBlock[] {
  return [...sourceText.matchAll(FENCED_BLOCK_PATTERN)].map((match) => ({
    body: match[2],
    bodyStart: match.index + match[0].indexOf(match[2]),
    language: match[1].toLocaleLowerCase("en-US"),
  }));
}

function getSourceLines(sourceText: string, baseOffset = 0): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  while (start <= sourceText.length) {
    const newlineIndex = sourceText.indexOf("\n", start);
    const end = newlineIndex >= 0 ? newlineIndex : sourceText.length;
    lines.push({
      start: baseOffset + start,
      text: sourceText.slice(start, end).replace(/\r$/u, ""),
    });

    if (newlineIndex < 0) {
      break;
    }

    start = newlineIndex + 1;
  }

  return lines;
}

function splitMarkdownCells(line: SourceLine): SourceRange[] {
  const ranges: SourceRange[] = [];
  const rowStart = line.text.startsWith("|") ? 1 : 0;
  const rowEnd = line.text.endsWith("|") ? line.text.length - 1 : line.text.length;
  let cellStart = rowStart;

  for (let index = rowStart; index <= rowEnd; index += 1) {
    const isDelimiter = index === rowEnd ||
      (line.text[index] === "|" && line.text[index - 1] !== "\\");

    if (!isDelimiter) {
      continue;
    }

    ranges.push(trimRange(line.text, line.start, cellStart, index));
    cellStart = index + 1;
  }

  return ranges;
}

function splitDelimitedCells(
  line: SourceLine,
  delimiter: string,
): SourceRange[] {
  const ranges: SourceRange[] = [];
  let cellStart = 0;
  let insideQuotes = false;

  for (let index = 0; index <= line.text.length; index += 1) {
    const character = line.text[index];

    if (character === '"') {
      if (insideQuotes && line.text[index + 1] === '"') {
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    }

    if (index === line.text.length || (character === delimiter && !insideQuotes)) {
      ranges.push(trimRange(line.text, line.start, cellStart, index));
      cellStart = index + 1;
    }
  }

  return ranges;
}

function trimRange(
  text: string,
  baseOffset: number,
  start: number,
  end: number,
): SourceRange {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && /[\s"']/u.test(text[trimmedStart])) {
    trimmedStart += 1;
  }

  while (trimmedEnd > trimmedStart && /[\s"']/u.test(text[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }

  return {
    start: baseOffset + trimmedStart,
    end: baseOffset + trimmedEnd,
    value: text.slice(trimmedStart, trimmedEnd),
  };
}

function isPersonFieldName(value: string): boolean {
  const normalized = value
    .replace(/[*_`"']/gu, "")
    .replace(/[\s\-_]/gu, "")
    .toLocaleLowerCase("en-US");

  return PERSON_FIELD_NAMES.has(normalized);
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function decodeJsonString(value: string): string | undefined {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return undefined;
  }
}
