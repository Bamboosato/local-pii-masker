export const COMMON_JAPANESE_SURNAMES =
  "佐藤|鈴木|高橋|田中|伊藤|渡辺|山本|中村|小林|加藤|吉田|山田|佐々木|山口|松本|井上|木村|林|清水|斎藤|斉藤|池田|阿部|橋本|山崎|森|石川|前田|藤田|岡田|後藤|長谷川|村上|近藤|石井|坂本|遠藤|青木|藤井|西村|福田|太田|三浦|藤原|岡本|松田|中川|中島|原田|小川|竹内|森田|和田|中野|上田|工藤|杉山|内田|増田|丸山|宮崎|河野|柴田|武田|谷口";

export const COMMON_JAPANESE_SURNAME_SET = new Set(
  COMMON_JAPANESE_SURNAMES.split("|"),
);

const SINGLE_KANJI_GIVEN_NAME_PATTERN = new RegExp(
  `^(?:${COMMON_JAPANESE_SURNAMES})[ \u3000]+[一-龥々]$`,
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
