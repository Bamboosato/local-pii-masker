const PREFECTURE_PATTERN =
  "(?:北海道|東京都|京都府|大阪府|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)";
const PLACE_CHARS =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}々ヶケー・";
const ADDRESS_BOUNDARY_CHARS =
  "\\p{Script=Han}\\p{Script=Katakana}々ヶケー";
const MUNICIPALITY_PATTERN =
  `(?:[${PLACE_CHARS}]{1,12}市(?:[${PLACE_CHARS}]{1,12}区)?|` +
  `[${PLACE_CHARS}]{1,12}区|` +
  `[${PLACE_CHARS}]{1,12}郡[${PLACE_CHARS}]{1,12}(?:町|村)|` +
  `[${PLACE_CHARS}]{1,12}(?:町|村))`;
const JAPANESE_NUMBER = "[0-9０-９一二三四五六七八九十百千]+";
const ADDRESS_CONTEXT_PATTERN =
  "(?:自宅住所|登録住所|配送先|住所|所在地|送付先)[ \\u3000]*(?:(?:は)[ \\u3000]*|[：:][ \\u3000]*)?";
const ADDRESS_PREFIX_PATTERN =
  `(${ADDRESS_CONTEXT_PATTERN}|^|[^${ADDRESS_BOUNDARY_CHARS}])`;

export const LEADING_ADDRESS_CONTEXT_PATTERN = new RegExp(
  `^${ADDRESS_CONTEXT_PATTERN}`,
  "u",
);

function createLotNumberPattern(optionalLineBreak: string): string {
  return (
    `(?:(?:${JAPANESE_NUMBER}丁目${optionalLineBreak})?${JAPANESE_NUMBER}` +
    `(?:番地|番(?:${optionalLineBreak}${JAPANESE_NUMBER}号)?)|` +
    `(?:${JAPANESE_NUMBER}丁目${optionalLineBreak})?${JAPANESE_NUMBER}号|` +
    `${JAPANESE_NUMBER}(?:[-－]${JAPANESE_NUMBER}){1,3})`
  );
}

export function createJapaneseAddressPattern(
  lineBreakPattern?: string,
): RegExp {
  const optionalLineBreak = lineBreakPattern
    ? `(?:${lineBreakPattern})?`
    : "";
  const buildingSeparator = lineBreakPattern
    ? `(?:[ \\u3000]+|${lineBreakPattern})`
    : "[ \\u3000]+";
  const buildingPattern =
    `(?:${buildingSeparator}(?:` +
    `[^\\n\\r、。;；!?！？]{1,40}?(?:階|号室)|` +
    `[^\\n\\r、。;；!?！？]{1,40}?(?:ビル|タワー|マンション|ハイツ|コーポ|館|棟)))?`;
  const lotNumberPattern = createLotNumberPattern(optionalLineBreak);
  const addressPattern =
    `((?:${PREFECTURE_PATTERN}${optionalLineBreak})?` +
    `${MUNICIPALITY_PATTERN}${optionalLineBreak}` +
    `[${PLACE_CHARS}]{1,24}?${optionalLineBreak}` +
    `${lotNumberPattern}${buildingPattern})`;

  return new RegExp(ADDRESS_PREFIX_PATTERN + addressPattern, "gu");
}
