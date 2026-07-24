import type { MaskEntry, OccurrenceMaskingMode } from "../types";
import {
  AMBIGUOUS_JAPANESE_SURNAMES,
  normalizeJapaneseName,
} from "../reference/japanesePersonNames";
import {
  SINGLE_SURNAME_COMMON_WORD_RULES,
  type SingleSurnameCommonWordRule,
} from "../reference/singleSurnameCommonWordRules";
import { normalizeText } from "../normalization/normalizeText";

export type OccurrenceDecision = "mask" | "suppress";

export type MaskOccurrence = {
  start: number;
  end: number;
  decision: OccurrenceDecision;
  reason?: string;
};

/**
 * General-language phrases are kept separately from the surname dictionary.
 * These are intentionally narrow exclusions: an unknown phrase must not be
 * treated as a general word merely because a kanji follows an ambiguous
 * surname.
 */
/**
 * 既存利用者向けの互換名。新しい辞書は姓辞書から分離した
 * SINGLE_SURNAME_COMMON_WORD_RULES を正本とします。
 */
export const JAPANESE_SURNAME_GENERAL_TERM_PATTERNS = SINGLE_SURNAME_COMMON_WORD_RULES;
export type GeneralTermPattern = SingleSurnameCommonWordRule;

const PERSON_LABEL_PATTERN =
  /(?:氏名|名前|名義人|担当者?|責任者|患者氏名|申請者|代表者|作成者|承認者|確認者|所有者|利用者|顧客)\s*(?:[:：=]|は|が)?\s*$/u;
const HONORIFIC_OR_ROLE_PATTERN =
  /^(?:さん|様|殿|氏|先生|君|くん|ちゃん|相談役|顧問|会長|社長|副社長|専務|常務|監査役|執行役員|理事長?|本部長|事業部長|部長(?:代理)?|次長|室長|課長|参事|主幹|係長|主任|チーフ|リーダー|マネージャー)/u;
const KANJI_NAME_CONTINUATION_PATTERN = /^[ \u3000\r\n]+[一-龥々]{1,4}(?=$|[\s\u3000、。，,.！？!?「」『』（）()【】、])/u;
const LIST_ITEM_PREFIX_PATTERN =
  /(?:^|\r?\n)[ \u3000]*(?:[-*・]|[0-9０-９]+[.)．、])[ \u3000]*$/u;

export function isContextualMaskEntry(
  entry: Pick<MaskEntry, "category" | "originalText" | "sources">,
  mode: OccurrenceMaskingMode,
): boolean {
  return (
    mode === "contextual_ambiguous_surnames" &&
    entry.category === "PERSON" &&
    !entry.sources.includes("manual") &&
    AMBIGUOUS_JAPANESE_SURNAMES.has(normalizeJapaneseName(entry.originalText))
  );
}

export function decideMaskOccurrence(params: {
  text: string;
  entry: Pick<MaskEntry, "category" | "originalText" | "sources">;
  start: number;
  end: number;
  mode: OccurrenceMaskingMode;
}): MaskOccurrence {
  const { text, entry, start, end, mode } = params;
  const normalizedText = normalizeText(text);

  if (!isContextualMaskEntry(entry, mode)) {
    return { start, end, decision: "mask" };
  }

  if (entry.sources.includes("ner") || hasStrongPersonContext(normalizedText, start, end)) {
    return { start, end, decision: "mask", reason: "人名文脈" };
  }

  const generalTerm = findGeneralTermPattern(normalizedText, entry.originalText, start);

  if (generalTerm) {
    return {
      start,
      end,
      decision: "suppress",
      reason: generalTerm.description ?? "一般語辞書",
    };
  }

  // Recall is preferred when neither side is conclusive.
  return { start, end, decision: "mask", reason: "文脈不確実" };
}

export function shouldMaskOccurrence(params: {
  text: string;
  entry: Pick<MaskEntry, "category" | "originalText" | "sources">;
  start: number;
  end: number;
  mode: OccurrenceMaskingMode;
}): boolean {
  return decideMaskOccurrence(params).decision === "mask";
}

export function countMaskableOccurrences(
  text: string,
  entry: Pick<MaskEntry, "category" | "originalText" | "sources">,
  mode: OccurrenceMaskingMode,
): number {
  const normalizedText = normalizeText(text);
  const normalizedTarget = normalizeText(entry.originalText);

  if (normalizedTarget.length === 0) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (position <= normalizedText.length) {
    const start = normalizedText.indexOf(normalizedTarget, position);

    if (start === -1) {
      break;
    }

    const end = start + normalizedTarget.length;

    if (shouldMaskOccurrence({ text: normalizedText, entry, start, end, mode })) {
      count += 1;
    }

    position = end;
  }

  return count;
}

function hasStrongPersonContext(text: string, start: number, end: number): boolean {
  const lineStart = Math.max(text.lastIndexOf("\n", start - 1) + 1, 0);
  const linePrefix = text.slice(lineStart, start);
  const after = text.slice(end, end + 8);

  if (PERSON_LABEL_PATTERN.test(linePrefix)) {
    return true;
  }

  if (HONORIFIC_OR_ROLE_PATTERN.test(after)) {
    return true;
  }

  if (KANJI_NAME_CONTINUATION_PATTERN.test(after)) {
    return true;
  }

  return LIST_ITEM_PREFIX_PATTERN.test(linePrefix);
}

function findGeneralTermPattern(
  text: string,
  surname: string,
  start: number,
): GeneralTermPattern | undefined {
  const normalizedSurname = normalizeJapaneseName(surname);

  return SINGLE_SURNAME_COMMON_WORD_RULES.find((pattern) => {
    if (normalizeJapaneseName(pattern.surname) !== normalizedSurname) {
      return false;
    }

    const normalizedPhrase = normalizeText(pattern.pattern);
    const surnameOffset = normalizedPhrase.indexOf(normalizedSurname);

    if (surnameOffset < 0 || start < surnameOffset) {
      return false;
    }

    return text.slice(start - surnameOffset, start - surnameOffset + normalizedPhrase.length) === normalizedPhrase;
  });
}
