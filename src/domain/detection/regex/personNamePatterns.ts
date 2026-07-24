import {
  AMBIGUOUS_JAPANESE_SURNAMES,
  COMMON_JAPANESE_SURNAMES,
  COMMON_JAPANESE_SURNAME_SET,
  NON_AMBIGUOUS_JAPANESE_SURNAMES,
  createSurnamePattern,
  createSurnameSurfacePattern,
} from "../../reference/japanesePersonNames";

export {
  AMBIGUOUS_JAPANESE_SURNAMES,
  COMMON_JAPANESE_SURNAMES,
  COMMON_JAPANESE_SURNAME_SET,
  NON_AMBIGUOUS_JAPANESE_SURNAMES,
  createSurnamePattern,
  createSurnameSurfacePattern,
};

export const COMMON_JAPANESE_SURNAMES_PATTERN = createSurnameSurfacePattern(
  COMMON_JAPANESE_SURNAMES,
);
export const COMMON_JAPANESE_NON_AMBIGUOUS_SURNAMES_PATTERN =
  createSurnameSurfacePattern(NON_AMBIGUOUS_JAPANESE_SURNAMES);

const SINGLE_KANJI_GIVEN_NAME_PATTERN = new RegExp(
  `^(?:${COMMON_JAPANESE_SURNAMES_PATTERN})[ \u3000]+[一-龥々]$`,
  "u",
);
const OCR_SPACED_GIVEN_NAME_CONTINUATION =
  /^[ \u3000]+[一-龥々](?=$|[\s\u3000、。，,.]|さん|様|氏|から|として|である|です|が|は|を|に|へ|と)/u;

export function extendOcrSpacedGivenNameEnd(
  sourceText: string,
  candidateStart: number,
  candidateEnd: number,
  rangeEnd = sourceText.length,
): number {
  const candidateText = sourceText.slice(candidateStart, candidateEnd);

  if (!SINGLE_KANJI_GIVEN_NAME_PATTERN.test(candidateText)) {
    return candidateEnd;
  }

  const continuation = sourceText
    .slice(candidateEnd, rangeEnd)
    .match(OCR_SPACED_GIVEN_NAME_CONTINUATION)?.[0];

  return continuation ? candidateEnd + continuation.length : candidateEnd;
}
