/** Canonical Japanese surnames used by the detection rules. */
export type SurnameConfidence = "common" | "extended" | "ambiguous";

export type SurnameEntry = {
  surface: string;
  normalized: string;
  confidence: SurnameConfidence;
};

export const JAPANESE_SURNAMES = [
  "佐藤",
  "鈴木",
  "高橋",
  "田中",
  "伊藤",
  "渡辺",
  "山本",
  "中村",
  "小林",
  "加藤",
  "吉田",
  "山田",
  "佐々木",
  "山口",
  "松本",
  "井上",
  "木村",
  "林",
  "清水",
  "斎藤",
  "東",
  "南",
  "関",
  "堀",
  "辻",
  "池田",
  "阿部",
  "橋本",
  "山崎",
  "森",
  "石川",
  "前田",
  "藤田",
  "岡田",
  "後藤",
  "長谷川",
  "村上",
  "近藤",
  "石井",
  "坂本",
  "遠藤",
  "青木",
  "藤井",
  "西村",
  "福田",
  "太田",
  "三浦",
  "藤原",
  "岡本",
  "松田",
  "中川",
  "中島",
  "原田",
  "小川",
  "竹内",
  "森田",
  "和田",
  "中野",
  "上田",
  "工藤",
  "杉山",
  "内田",
  "増田",
  "丸山",
  "宮崎",
  "河野",
  "柴田",
  "武田",
  "谷口",
  "山下",
  "小野",
  "田村",
  "金子",
  "中山",
  "石田",
  "原",
  "酒井",
  "横山",
  "宮本",
  "高木",
  "安藤",
  "大野",
  "高田",
  "今井",
  "小島",
  "藤本",
  "村田",
  "上野",
  "小山",
  "大塚",
  "平野",
  "菅原",
  "久保",
  "千葉",
  "松井",
  "岩崎",
  "木下",
  "野口",
  "松尾",
  "菊地",
  "野村",
  "新井",
  "渡部",
  "佐野",
  "杉本",
  "大西",
  "桜井",
  "古川",
  "島田",
  "市川",
  "小松",
  "高野",
  "水野",
  "吉川",
  "山内",
  "西田",
  "浜田",
  "西川",
  "菊池",
  "北村",
  "五十嵐",
  "安田",
  "中田",
  "平田",
  "川口",
  "川崎",
  "飯田",
  "久保田",
  "吉村",
  "福島",
  "中西",
  "岩田",
  "服部",
  "樋口",
  "永井",
  "松岡",
  "山中",
  "森本",
  "矢野",
  "秋山",
  "土屋",
  "石原",
  "松下",
  "馬場",
  "大橋",
  "松浦",
  "吉岡",
  "荒木",
  "小池",
  "大久保",
  "熊谷",
  "浅野",
  "野田",
  "広瀬",
  "川村",
  "星野",
  "大谷",
  "黒田",
  "沢田",
  "尾崎",
  "田辺",
  "小沢",
  "永田",
  "松村",
  "望月",
  "内藤",
  "西山",
  "大島",
  "岩本",
  "平井",
  "片山",
  "本間",
  "横田",
  "早川",
  "荒井",
  "岡崎",
  "鎌田",
  "小田",
  "成田",
  "宮田",
  "大石",
  "石橋",
  "篠原",
  "高山",
  "須藤",
  "萩原",
  "小西",
  "栗原",
  "松原",
  "伊東",
  "三宅",
  "大森",
  "福井",
  "奥村",
  "富田",
  "川上",
  "川島",
  "岡村",
  "西尾",
  "細川",
  "佐久間",
  "三好",
  "大和田",
  "石塚",
  "田口",
  "中井",
  "黒川",
  "長田",
  "大村",
  "大川",
  "西原",
  "河合",
  "宮下",
  "岩井",
  "宮川",
] as const;

/** Compatibility name retained while consumers migrate to JAPANESE_SURNAMES. */
export const COMMON_JAPANESE_SURNAMES = JAPANESE_SURNAMES;

export const SURNAME_VARIANT_MAP: Readonly<Record<string, string>> = {
  髙: "高",
  﨑: "崎",
  𠮷: "吉",
  邊: "辺",
  邉: "辺",
  齋: "斎",
  齊: "斎",
  斉: "斎",
  濱: "浜",
  濵: "浜",
  瀨: "瀬",
  德: "徳",
  國: "国",
  塚: "塚",
  神: "神",
};

export function normalizeJapaneseName(value: string): string {
  return [...value.normalize("NFKC")]
    .map((character) => SURNAME_VARIANT_MAP[character] ?? character)
    .join("");
}

export const AMBIGUOUS_JAPANESE_SURNAMES = new Set([
  "林",
  "森",
  "原",
  "東",
  "南",
  "関",
  "堀",
  "岡",
  "辻",
].map((surname) => normalizeJapaneseName(surname)));

/** Surnames safe to use in a standalone surname-plus-given-name heuristic. */
export const NON_AMBIGUOUS_JAPANESE_SURNAMES = JAPANESE_SURNAMES.filter(
  (surname) => !AMBIGUOUS_JAPANESE_SURNAMES.has(normalizeJapaneseName(surname)),
);

export const COMMON_JAPANESE_SURNAME_SET = new Set<string>(
  JAPANESE_SURNAMES.map(normalizeJapaneseName),
);

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createSurnamePattern(surnames: readonly string[]): string {
  return sortSurnames(surnames.map(normalizeJapaneseName))
    .map(escapeRegExp)
    .join("|");
}

/** Builds a source-text pattern that accepts configured surname variants. */
export function createSurnameSurfacePattern(
  surnames: readonly string[],
): string {
  return sortSurnames(surnames.map(normalizeJapaneseName))
    .map((surname) => createVariantPattern(surname))
    .join("|");
}

/** Builds a source-text pattern that also permits one OCR space per character. */
export function createSurnamePatternWithOptionalSpacing(
  surnames: readonly string[],
): string {
  return sortSurnames(surnames.map(normalizeJapaneseName))
    .map((surname) => createVariantPattern(surname, true))
    .join("|");
}

function sortSurnames(surnames: readonly string[]): string[] {
  return [...new Set(surnames)].sort((left, right) => {
    const lengthDifference = right.length - left.length;

    if (lengthDifference !== 0) {
      return lengthDifference;
    }

    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function createVariantPattern(surname: string, allowSpacing = false): string {
  return [...surname]
    .map((character) => {
      const variants = [
        character,
        ...Object.entries(SURNAME_VARIANT_MAP)
          .filter(([, canonical]) => canonical === character)
          .map(([variant]) => variant),
      ];
      const uniqueVariants = [...new Set(variants)];
      const characterPattern =
        uniqueVariants.length === 1
          ? escapeRegExp(uniqueVariants[0])
          : `[${uniqueVariants.map(escapeRegExp).join("")}]`;

      return `${characterPattern}${allowSpacing ? "[ \\u3000]?" : ""}`;
    })
    .join("");
}
