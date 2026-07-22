import type {
  DocumentNormalizationEvent,
  DocumentNormalizationMode,
  DocumentNormalizationResult,
  DocumentNormalizationRuleId,
  NormalizationChangeKind,
  NormalizationRuleSummary,
  SourceMapping,
  TextRange,
} from "./types";

type MappedCodeUnit = {
  value: string;
  originalStart: number;
  originalEnd: number;
  changed: boolean;
  ruleIds: DocumentNormalizationRuleId[];
};

type WorkingText = {
  units: MappedCodeUnit[];
  events: DocumentNormalizationEvent[];
};

type Edit = {
  start: number;
  end: number;
  replacement: string;
  ruleId: DocumentNormalizationRuleId;
  kind: NormalizationChangeKind;
};

const ASCII_FULLWIDTH_START = 0xff01;
const ASCII_FULLWIDTH_END = 0xff5e;
const ASCII_OFFSET = 0xfee0;
const ZERO_WIDTH_CHARACTERS = new Set(["\u200b", "\u2060", "\ufeff"]);
const SPACE_CHARACTERS = new Set(["\u00a0", "\u2007", "\u202f", "\u3000"]);
const HYPHEN_VARIANTS = new Set(["‐", "‑", "‒", "–", "—", "―", "−", "﹣", "－"]);
const JAPANESE_OR_DIGIT = /[一-龥々ぁ-んァ-ヶ0-9]/u;
const ASCII_WORD = /[A-Za-z0-9]/u;
const LIST_ITEM_PATTERN =
  /^(?:\s{0,3}(?:[・●○■□※＊*-]|\d+[.)]|[（(]\d+[）)]|[①-⑳]|[ア-ン][.)]|第\d+))\s*/u;
const HEADING_PATTERN = /^\s{0,3}#{1,6}(?:\s|$)/u;
const HORIZONTAL_RULE_PATTERN = /^\s{0,3}(?:[-*_]\s*){3,}$/u;
const LABEL_PATTERN =
  /^(?:氏名|名前|担当者|住所|所在地|郵便番号|電話番号|携帯番号|FAX|ファックス|メールアドレス|生年月日|勤務先|会社名|口座番号|会員番号|顧客番号|契約番号|証明書番号)$/u;
const ADDRESS_HINT_PATTERN = /(?:都|道|府|県|市|区|町|村|丁目|番地?|号)/u;
const ORGANIZATION_HINT_PATTERN = /(?:株式会社|有限会社|合同会社|会社|法人|センター|ソリューションズ|部|課|室|グループ)/u;
const PERSON_LABEL_PATTERN = /(?:氏名|名前|担当者)/u;
const LINE_BREAK_PATTERN = /[ \t]*\n[ \t]*/g;
const EMAIL_LOCAL_CHARACTERS = new Set(
  Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+/=?^_`{|}~-"),
);
const PHONE_PATTERN = /\d[\d\s\r\n‐‑‒–—―−﹣－-]{5,}\d/g;
// Keep paragraph/line breaks before a postal code intact. OCR line breaks are
// still allowed inside the 3+4 digit code itself.
const POSTAL_PATTERN = /(?<![\d-])〒?[ \t\u3000]*\d{3}[\s\u3000\r\n]*(?:[‐‑‒–—―−﹣－-][\s\u3000\r\n]*|[\s\u3000\r\n]+)\d{4}(?![\s\u3000]*[‐‑‒–—―−﹣－-][\s\u3000\r\n]*\d)/g;
const DATE_PATTERN = /\d{4}[\s\u3000\r\n]*年[\s\u3000\r\n]*\d{1,2}[\s\u3000\r\n]*月[\s\u3000\r\n]*\d{1,2}[\s\u3000\r\n]*日/g;
const TIME_PATTERN = /\d{1,2}[\s\u3000]*[:：][\s\u3000]*\d{2}(?:[\s\u3000]*[:：][\s\u3000]*\d{2})?/g;
const ZERO_WIDTH_MARK_PATTERN = /\p{M}/u;

export function normalizeDocumentText(
  text: string,
  mode: DocumentNormalizationMode,
): DocumentNormalizationResult {
  let working = createInitialWorkingText(text);
  working = applyLineEndingRule(working);
  working = applyInvisibleCharacterRule(working);
  working = applyFullwidthRule(working);
  working = applyStructuredRules(working);
  working = applyLabelValueRule(working);
  working = applyListRule(working);

  if (mode === "detection_priority") {
    working = applyJapaneseInterCharacterSpaceRule(working);
    working = applyGenericLineJoinRule(working);
  }

  working = applyExcessWhitespaceRule(working, mode);

  const normalizedText = working.units.map((unit) => unit.value).join("");
  const events = mergeEvents(working.events);
  const mappings = working.units.map<SourceMapping>((unit) => ({
    originalStart: unit.originalStart,
    originalEnd: unit.originalEnd,
    changed: unit.changed,
    ruleIds: [...unit.ruleIds],
  }));

  return {
    normalizedText,
    mappings,
    events,
    summary: buildSummary(events),
    changedLocationCount: mergeRanges(events.map((event) => event.originalRange)).length,
  };
}

function createInitialWorkingText(text: string): WorkingText {
  const units: MappedCodeUnit[] = [];
  const events: DocumentNormalizationEvent[] = [];
  let index = 0;

  while (index < text.length) {
    const start = index;
    const firstCodePoint = text.codePointAt(index);
    const codePointLength = firstCodePoint && firstCodePoint > 0xffff ? 2 : 1;
    index += codePointLength;

    while (index < text.length) {
      const mark = text.codePointAt(index);
      const markLength = mark && mark > 0xffff ? 2 : 1;
      const markValue = text.slice(index, index + markLength);
      if (!ZERO_WIDTH_MARK_PATTERN.test(markValue)) {
        break;
      }
      index += markLength;
    }

    const original = text.slice(start, index);
    const normalized = original.normalize("NFC");
    const changed = original !== normalized;
    if (changed) {
      events.push({
        ruleId: "unicode_nfc",
        kind: "character",
        originalRange: { start, end: index },
      });
    }
    for (let offset = 0; offset < normalized.length; offset += 1) {
      units.push({
        value: normalized[offset],
        originalStart: start,
        originalEnd: index,
        changed,
        ruleIds: changed ? ["unicode_nfc"] : [],
      });
    }
  }

  return { units, events };
}

function applyLineEndingRule(input: WorkingText): WorkingText {
  return applyRegexEdits(
    input,
    /\r\n|\r/g,
    "line_ending",
    "line_break",
    () => "\n",
  );
}

function applyInvisibleCharacterRule(input: WorkingText): WorkingText {
  const protectedRanges = getProtectedRanges(toText(input));
  const next = cloneWorkingText(input);
  let runStart: number | undefined;
  let runEnd = 0;
  let runRuleId: DocumentNormalizationRuleId | undefined;

  const flush = () => {
    if (runStart !== undefined) {
      next.events.push({
        ruleId: runRuleId ?? "invisible_character",
        kind: "character",
        originalRange: originalRange(input.units.slice(runStart, runEnd)),
      });
      runStart = undefined;
      runRuleId = undefined;
    }
  };

  const replaceUnit = (index: number, value: string, ruleId: DocumentNormalizationRuleId) => {
    const unit = next.units[index];
    if (runRuleId !== undefined && runRuleId !== ruleId) {
      flush();
    }
    next.units[index] = { ...unit, value, changed: true, ruleIds: addRule(unit.ruleIds, ruleId) };
    runStart ??= index;
    runEnd = index + 1;
    runRuleId = ruleId;
  };

  for (let index = 0; index < next.units.length; index += 1) {
    const unit = next.units[index];
    if (isProtectedRange(protectedRanges, unit.originalStart, unit.originalEnd)) {
      flush();
      continue;
    }
    if (ZERO_WIDTH_CHARACTERS.has(unit.value)) {
      replaceUnit(index, "", "invisible_character");
      continue;
    }
    if (SPACE_CHARACTERS.has(unit.value)) {
      replaceUnit(index, " ", "special_whitespace");
      continue;
    }
    if (isRemovableControl(unit.value)) {
      replaceUnit(index, "", "invisible_character");
      continue;
    }
    flush();
  }
  flush();
  return next;
}

function applyFullwidthRule(input: WorkingText): WorkingText {
  const protectedRanges = getProtectedRanges(toText(input));
  const next = cloneWorkingText(input);
  let runStart: number | undefined;
  let runEnd = 0;

  const flush = () => {
    if (runStart !== undefined) {
      next.events.push({
        ruleId: "fullwidth_ascii",
        kind: "character",
        originalRange: originalRange(input.units.slice(runStart, runEnd)),
      });
      runStart = undefined;
    }
  };

  for (let index = 0; index < next.units.length; index += 1) {
    const unit = next.units[index];
    const code = unit.value.charCodeAt(0);
    if (isProtectedRange(protectedRanges, unit.originalStart, unit.originalEnd)) {
      flush();
      continue;
    }
    const replacement =
      code >= ASCII_FULLWIDTH_START && code <= ASCII_FULLWIDTH_END
        ? String.fromCharCode(code - ASCII_OFFSET)
        : unit.value === "　"
          ? " "
          : unit.value;
    if (replacement === unit.value) {
      flush();
      continue;
    }
    next.units[index] = {
      ...unit,
      value: replacement,
      changed: true,
      ruleIds: addRule(unit.ruleIds, "fullwidth_ascii"),
    };
    runStart ??= index;
    runEnd = index + 1;
  }
  flush();
  return next;
}

function applyStructuredRules(input: WorkingText): WorkingText {
  let next = input;
  next = applyEmailRule(next);
  next = applyValidatedWhitespace(next, PHONE_PATTERN, "phone_spacing", "phone_line_break", (value) => {
    const compact = removeStructuredWhitespace(value);
    return isValidPhone(compact) ? replaceHyphens(compact) : undefined;
  });
  next = applyValidatedWhitespace(next, POSTAL_PATTERN, "postal_code_spacing", "postal_code_line_break", (value) => {
    const compact = removeStructuredWhitespace(value);
    return /^〒?\d{3}-\d{4}$/u.test(replaceHyphens(compact))
      ? replaceHyphens(compact)
      : undefined;
  });
  next = applyValidatedWhitespace(next, DATE_PATTERN, "date_time_spacing", "date_time_line_break", (value) => {
    const compact = removeStructuredWhitespace(value);
    return isValidDate(compact) ? compact : undefined;
  });
  next = applyValidatedWhitespace(next, TIME_PATTERN, "date_time_spacing", "date_time_line_break", (value) => {
    const compact = removeStructuredWhitespace(value).replace(/：/gu, ":");
    return isValidTime(compact) ? compact : undefined;
  });

  return next;
}

/**
 * Finds email candidates with a bounded, deterministic parser. A large OCR
 * document can contain long runs of hyphens and punctuation; a single regex
 * with nested quantifiers can spend an unbounded amount of time backtracking
 * on those runs. Parsing around each `@` keeps the work predictable.
 */
function applyEmailRule(input: WorkingText): WorkingText {
  const text = toText(input);
  const protectedRanges = getProtectedRanges(text);
  const edits: Edit[] = [];
  let searchStart = 0;

  while (searchStart < text.length) {
    const atIndex = text.indexOf("@", searchStart);
    if (atIndex === -1) {
      break;
    }
    const candidate = findEmailCandidate(text, atIndex);
    if (candidate && !isProtectedRange(protectedRanges, candidate.start, candidate.end)) {
      const compact = removeStructuredWhitespace(candidate.value);
      if (isValidEmail(compact) && compact !== candidate.value) {
        edits.push({
          start: candidate.start,
          end: candidate.end,
          replacement: compact,
          ruleId: candidate.value.includes("\n") ? "email_line_break" : "email_spacing",
          kind: candidate.value.includes("\n") ? "line_break" : "space",
        });
        searchStart = candidate.end;
        continue;
      }
    }
    searchStart = atIndex + 1;
  }

  return applyEdits(input, edits);
}

type EmailCandidate = {
  start: number;
  end: number;
  value: string;
};

function findEmailCandidate(text: string, atIndex: number): EmailCandidate | undefined {
  let localStart = atIndex;
  while (localStart > 0) {
    const character = text[localStart - 1];
    if (EMAIL_LOCAL_CHARACTERS.has(character)) {
      localStart -= 1;
      continue;
    }
    if (isEmailWhitespace(character) && canBelongToEmailSeparator(text, localStart - 1, localStart)) {
      localStart -= 1;
      continue;
    }
    break;
  }

  const afterAt = consumeEmailSeparatorForward(text, atIndex + 1);
  const domain = parseEmailDomain(text, afterAt);
  if (
    !domain ||
    localStart === atIndex ||
    isEmailContinuationCharacter(text[domain.end])
  ) {
    return undefined;
  }

  return {
    start: localStart,
    end: domain.end,
    value: text.slice(localStart, domain.end),
  };
}

type EmailDomain = {
  end: number;
  labelCount: number;
};

function parseEmailDomain(text: string, start: number): EmailDomain | undefined {
  let position = start;
  const firstLabel = parseEmailDomainLabel(text, position);
  if (!firstLabel) {
    return undefined;
  }
  position = firstLabel.end;
  let labelCount = 1;

  while (true) {
    const separatorEnd = consumeEmailSeparatorForward(text, position);
    if (text[separatorEnd] !== ".") {
      break;
    }
    const nextLabelStart = consumeEmailSeparatorForward(text, separatorEnd + 1);
    const nextLabel = parseEmailDomainLabel(text, nextLabelStart);
    if (!nextLabel) {
      return undefined;
    }
    position = nextLabel.end;
    labelCount += 1;
  }

  return labelCount >= 2 ? { end: position, labelCount } : undefined;
}

function parseEmailDomainLabel(text: string, start: number): { end: number } | undefined {
  if (!isAsciiAlphaNumeric(text[start])) {
    return undefined;
  }
  let position = start + 1;
  while (position < text.length) {
    if (isAsciiAlphaNumeric(text[position])) {
      position += 1;
      continue;
    }
    if (text[position] !== "-") {
      break;
    }
    position += 1;
    position = consumeEmailSeparatorForward(text, position);
    if (!isAsciiAlphaNumeric(text[position])) {
      return undefined;
    }
    position += 1;
  }
  return { end: position };
}

function consumeEmailSeparatorForward(text: string, start: number): number {
  let position = start;
  while (text[position] === " " || text[position] === "\t") {
    position += 1;
  }
  if (text[position] === "\n") {
    position += 1;
    while (text[position] === " " || text[position] === "\t") {
      position += 1;
    }
  }
  return position;
}

function canBelongToEmailSeparator(text: string, whitespaceIndex: number, rightIndex: number): boolean {
  let leftIndex = whitespaceIndex - 1;
  while (isEmailWhitespace(text[leftIndex])) {
    leftIndex -= 1;
  }
  let right = rightIndex;
  while (isEmailWhitespace(text[right])) {
    right += 1;
  }
  const newlineCount = text.slice(leftIndex + 1, right).split("\n").length - 1;
  if (newlineCount > 1) {
    return false;
  }
  const left = text[leftIndex];
  const rightCharacter = text[right];
  return (
    rightCharacter === "@" ||
    left === "." ||
    left === "-" ||
    rightCharacter === "." ||
    rightCharacter === "-"
  );
}

function isEmailWhitespace(value: string | undefined): boolean {
  return value === " " || value === "\t" || value === "\n";
}

function isEmailContinuationCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9._%+\-@]/u.test(value);
}

function isAsciiAlphaNumeric(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z0-9]$/u.test(value);
}

function applyValidatedWhitespace(
  input: WorkingText,
  pattern: RegExp,
  spaceRule: DocumentNormalizationRuleId,
  lineRule: DocumentNormalizationRuleId,
  normalize: (value: string) => string | undefined,
): WorkingText {
  const text = toText(input);
  const edits: Edit[] = [];
  let lastEnd = -1;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start < lastEnd) {
      continue;
    }
    if (isProtectedRange(getProtectedRanges(text), start, end)) {
      continue;
    }
    const replacement = normalize(match[0]);
    if (!replacement || replacement === match[0]) {
      continue;
    }
    edits.push({
      start,
      end,
      replacement,
      ruleId: match[0].includes("\n") ? lineRule : spaceRule,
      kind: match[0].includes("\n") ? "line_break" : "space",
    });
    lastEnd = end;
  }
  return applyEdits(input, edits);
}

function applyLabelValueRule(input: WorkingText): WorkingText {
  const text = toText(input);
  const edits: Edit[] = [];
  const pattern = /^([^\r\n:：]{1,16})([ \t]*[:：]?[ \t]*)\n[ \t]*([^\r\n]{1,256})$/gmu;
  for (const match of text.matchAll(pattern)) {
    const label = match[1]?.trim() ?? "";
    if (!LABEL_PATTERN.test(label)) {
      continue;
    }
    const start = (match.index ?? 0) + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    const end = (match.index ?? 0) + match[0].length - (match[3]?.length ?? 0);
    if (isProtectedRange(getProtectedRanges(text), match.index ?? 0, (match.index ?? 0) + match[0].length)) {
      continue;
    }
    const separator = match[2]?.includes(":") || match[2]?.includes("：") ? "" : " ";
    edits.push({
      start,
      end,
      replacement: `${separator}`,
      ruleId: "label_value_line_break",
      kind: "line_break",
    });
  }
  return applyEdits(input, edits);
}

function applyListRule(input: WorkingText): WorkingText {
  return applyLineJoin(input, "list_item_wrap", (beforeLine, nextLine, text, start) => {
    if (!isListContinuation(text, start, beforeLine, nextLine)) {
      return undefined;
    }
    return joinerFor(beforeLine, nextLine);
  });
}

function applyJapaneseInterCharacterSpaceRule(input: WorkingText): WorkingText {
  let next = input;
  const pattern = /([一-龥々ぁ-んァ-ヶ0-9])[ \u3000]([一-龥々ぁ-んァ-ヶ0-9])/gu;
  let previous = "";
  while (previous !== toText(next)) {
    previous = toText(next);
    next = applyRegexEdits(
      next,
      pattern,
      "japanese_inter_character_space",
      "space",
      (match) => match.replace(/[ \u3000]/u, ""),
    );
  }
  return next;
}

function applyGenericLineJoinRule(input: WorkingText): WorkingText {
  return applyLineJoin(input, "japanese_line_wrap", (beforeLine, nextLine, text, start) => {
    if (!canJoinGeneralLines(beforeLine, nextLine, text, start)) {
      return undefined;
    }
    return joinerFor(beforeLine, nextLine);
  });
}

function applyLineJoin(
  input: WorkingText,
  fallbackRule: DocumentNormalizationRuleId,
  getReplacement: (beforeLine: string, nextLine: string, text: string, start: number) => string | undefined,
): WorkingText {
  const text = toText(input);
  const edits: Edit[] = [];
  for (const match of text.matchAll(LINE_BREAK_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isProtectedRange(getProtectedRanges(text), start, end)) {
      continue;
    }
    const beforeLineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLineEnd = text.indexOf("\n", end);
    const beforeLine = text.slice(beforeLineStart, start).trimEnd();
    const nextLine = text.slice(end, nextLineEnd === -1 ? text.length : nextLineEnd).trimStart();
    const replacement = getReplacement(beforeLine, nextLine, text, start);
    if (replacement === undefined) {
      continue;
    }
    const ruleId = classifyLineJoinRule(beforeLine, nextLine, fallbackRule);
    edits.push({
      start,
      end,
      replacement,
      ruleId,
      kind: replacement === "" ? "join" : "line_break",
    });
  }
  return applyEdits(input, edits);
}

function applyExcessWhitespaceRule(
  input: WorkingText,
  mode: DocumentNormalizationMode,
): WorkingText {
  let next = input;
  const text = toText(next);
  const protectedRanges = getProtectedRanges(text);
  next = applyRegexEdits(next, /[ \t]{2,}/g, "excess_whitespace", "space", (match, start) => {
    if (isProtectedRange(protectedRanges, start, start + match.length)) {
      return match;
    }
    return mode === "detection_priority" ? " " : " ";
  });
  const nextProtectedRanges = getProtectedRanges(toText(next));
  return applyRegexEdits(next, /\n{3,}/g, "excess_whitespace", "line_break", (match, start) => {
    if (isProtectedRange(nextProtectedRanges, start, start + match.length)) {
      return match;
    }
    return "\n\n";
  });
}

function applyRegexEdits(
  input: WorkingText,
  pattern: RegExp,
  ruleId: DocumentNormalizationRuleId,
  kind: NormalizationChangeKind,
  replace: (match: string, start: number) => string,
): WorkingText {
  const text = toText(input);
  const protectedRanges = getProtectedRanges(text);
  const edits: Edit[] = [];
  let lastEnd = -1;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start < lastEnd) {
      continue;
    }
    if (isProtectedRange(protectedRanges, start, end)) {
      continue;
    }
    const replacement = replace(match[0], start);
    if (replacement !== match[0]) {
      edits.push({ start, end, replacement, ruleId, kind });
      lastEnd = end;
    }
  }
  return applyEdits(input, edits);
}

function applyEdits(input: WorkingText, edits: Edit[]): WorkingText {
  if (edits.length === 0) {
    return input;
  }
  const sorted = [...edits].sort((left, right) => right.start - left.start);
  const next = cloneWorkingText(input);
  for (const edit of sorted) {
    const sourceUnits = input.units.slice(edit.start, edit.end);
    const source = originalRange(sourceUnits);
    const replacementUnits = Array.from({ length: edit.replacement.length }, (_, index) => ({
      value: edit.replacement[index],
      originalStart: source.start,
      originalEnd: source.end,
      changed: true,
      ruleIds: [edit.ruleId],
    }));
    next.units.splice(edit.start, edit.end - edit.start, ...replacementUnits);
    next.events.push({ ruleId: edit.ruleId, kind: edit.kind, originalRange: source });
  }
  return next;
}

function cloneWorkingText(input: WorkingText): WorkingText {
  return {
    units: input.units.map((unit) => ({ ...unit, ruleIds: [...unit.ruleIds] })),
    events: [...input.events],
  };
}

function toText(input: WorkingText): string {
  return input.units.map((unit) => unit.value).join("");
}

function originalRange(units: MappedCodeUnit[]): TextRange {
  if (units.length === 0) {
    return { start: 0, end: 0 };
  }
  return {
    start: Math.min(...units.map((unit) => unit.originalStart)),
    end: Math.max(...units.map((unit) => unit.originalEnd)),
  };
}

function addRule(
  existing: DocumentNormalizationRuleId[],
  ruleId: DocumentNormalizationRuleId,
): DocumentNormalizationRuleId[] {
  return existing.includes(ruleId) ? existing : [...existing, ruleId];
}

function isRemovableControl(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || (code >= 127 && code <= 159);
}

function removeStructuredWhitespace(value: string): string {
  return value.replace(/[ \t\r\n\u3000]/gu, "");
}

function replaceHyphens(value: string): string {
  let result = "";
  for (const character of value) {
    result += HYPHEN_VARIANTS.has(character) ? "-" : character;
  }
  return result;
}

function isValidEmail(value: string): boolean {
  if (value.length > 254) {
    return false;
  }
  const atIndex = value.indexOf("@");
  if (atIndex <= 0 || atIndex !== value.lastIndexOf("@")) {
    return false;
  }
  const local = value.slice(0, atIndex);
  for (const character of local) {
    if (!EMAIL_LOCAL_CHARACTERS.has(character)) {
      return false;
    }
  }
  const labels = value.slice(atIndex + 1).split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) {
    return false;
  }
  return labels.every((label) => {
    for (const character of label) {
      if (character !== "-" && !isAsciiAlphaNumeric(character)) {
        return false;
      }
    }
    return true;
  });
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 10 && digits.length <= 11 && /^0\d{9,10}$/u.test(digits);
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/u.exec(value);
  if (!match) {
    return false;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function isValidTime(value: string): boolean {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
  if (!match) {
    return false;
  }
  return Number(match[1]) < 24 && Number(match[2]) < 60 && (match[3] === undefined || Number(match[3]) < 60);
}

function getProtectedRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let offset = 0;
  let inFence = false;
  let fenceStart = 0;
  for (const line of text.split(/\n/gu)) {
    const lineEnd = offset + line.length;
    if (/^\s*(?:```|~~~)/u.test(line)) {
      if (!inFence) {
        fenceStart = offset;
        inFence = true;
      } else {
        ranges.push({ start: fenceStart, end: lineEnd });
        inFence = false;
      }
    } else if (inFence || /^ {4,}\S/u.test(line)) {
      ranges.push({ start: offset, end: Math.min(text.length, lineEnd + 1) });
    }
    offset = lineEnd + 1;
  }
  if (inFence) {
    ranges.push({ start: fenceStart, end: text.length });
  }
  return mergeRanges(ranges);
}

function isProtectedRange(ranges: TextRange[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function isListContinuation(text: string, start: number, beforeLine: string, nextLine: string): boolean {
  if (LIST_ITEM_PATTERN.test(nextLine) || HEADING_PATTERN.test(nextLine) || HORIZONTAL_RULE_PATTERN.test(nextLine)) {
    return false;
  }
  const lines = text.slice(0, start).split("\n");
  let active = false;
  for (const line of lines) {
    if (line.trim().length === 0) {
      active = false;
    } else if (LIST_ITEM_PATTERN.test(line)) {
      active = true;
    }
  }
  return active && beforeLine.length > 0 && nextLine.length > 0;
}

function canJoinGeneralLines(beforeLine: string, nextLine: string, text: string, start: number): boolean {
  if (!beforeLine || !nextLine || /[。！？.!?]$/u.test(beforeLine)) {
    return false;
  }
  if (LIST_ITEM_PATTERN.test(nextLine) || HEADING_PATTERN.test(nextLine) || HORIZONTAL_RULE_PATTERN.test(nextLine)) {
    return false;
  }
  if (beforeLine.includes("|") || nextLine.includes("|")) {
    return false;
  }
  if (getProtectedRanges(text).some((range) => start >= range.start && start <= range.end)) {
    return false;
  }
  return true;
}

function joinerFor(beforeLine: string, nextLine: string): string {
  const before = beforeLine.slice(-1);
  const after = nextLine.slice(0, 1);
  return JAPANESE_OR_DIGIT.test(before) && JAPANESE_OR_DIGIT.test(after)
    ? ""
    : ASCII_WORD.test(before) && ASCII_WORD.test(after)
      ? " "
      : "";
}

function classifyLineJoinRule(
  beforeLine: string,
  nextLine: string,
  fallback: DocumentNormalizationRuleId,
): DocumentNormalizationRuleId {
  const value = `${beforeLine}${nextLine}`;
  if (PERSON_LABEL_PATTERN.test(beforeLine)) {
    return "person_line_break";
  }
  if (ADDRESS_HINT_PATTERN.test(value)) {
    return "address_line_break";
  }
  if (ORGANIZATION_HINT_PATTERN.test(value)) {
    return "organization_line_break";
  }
  return fallback;
}

function mergeEvents(events: DocumentNormalizationEvent[]): DocumentNormalizationEvent[] {
  const sorted = [...events]
    .filter((event) => event.originalRange.end > event.originalRange.start)
    .sort((left, right) => left.originalRange.start - right.originalRange.start || left.originalRange.end - right.originalRange.end);
  const merged: DocumentNormalizationEvent[] = [];
  for (const event of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.ruleId === event.ruleId &&
      previous.kind === event.kind &&
      event.originalRange.start <= previous.originalRange.end
    ) {
      previous.originalRange.end = Math.max(previous.originalRange.end, event.originalRange.end);
    } else {
      merged.push({ ...event, originalRange: { ...event.originalRange } });
    }
  }
  return merged;
}

function buildSummary(events: DocumentNormalizationEvent[]): NormalizationRuleSummary[] {
  const counts = new Map<string, NormalizationRuleSummary>();
  for (const event of events) {
    const key = `${event.ruleId}:${event.kind}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { ruleId: event.ruleId, kind: event.kind, count: 1 });
    }
  }
  return [...counts.values()];
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
