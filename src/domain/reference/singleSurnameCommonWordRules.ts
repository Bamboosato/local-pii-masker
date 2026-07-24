/**
 * 一文字姓が一般語の一部として現れる場合に、文脈付き出現箇所マスクで
 * 人名候補から除外するルールです。姓辞書本体とは分離して管理します。
 */
export type SingleSurnameCommonWordRuleType = "prefix" | "literal";

export type SingleSurnameCommonWordRule = {
  surname: string;
  pattern: string;
  type: SingleSurnameCommonWordRuleType;
  description?: string;
};

export const SINGLE_SURNAME_COMMON_WORD_RULES: readonly SingleSurnameCommonWordRule[] = [
  // 森
  { surname: "森", pattern: "森林", type: "prefix", description: "森林、森林保護、森林資源など" },
  { surname: "森", pattern: "森の中", type: "literal" },
  { surname: "森", pattern: "森の奥", type: "literal" },
  { surname: "森", pattern: "深い森", type: "literal" },
  { surname: "森", pattern: "森を歩", type: "prefix", description: "森を歩く、森を歩いたなど" },
  { surname: "森", pattern: "森に入", type: "prefix", description: "森に入る、森に入ったなど" },

  // 原
  { surname: "原", pattern: "原材料", type: "prefix" },
  { surname: "原", pattern: "原文", type: "prefix" },
  { surname: "原", pattern: "原則", type: "prefix" },
  { surname: "原", pattern: "原案", type: "prefix" },
  { surname: "原", pattern: "原稿", type: "prefix" },
  { surname: "原", pattern: "原価", type: "prefix" },
  { surname: "原", pattern: "原因", type: "prefix" },
  { surname: "原", pattern: "原点", type: "prefix" },
  { surname: "原", pattern: "原型", type: "prefix" },
  { surname: "原", pattern: "原子", type: "prefix" },
  { surname: "原", pattern: "原告", type: "prefix" },
  { surname: "原", pattern: "原産", type: "prefix" },
  { surname: "原", pattern: "原料", type: "prefix" },
  { surname: "原", pattern: "原動力", type: "literal" },
  { surname: "原", pattern: "原始", type: "prefix" },
  { surname: "原", pattern: "原本", type: "prefix" },
  { surname: "原", pattern: "原題", type: "prefix" },
  { surname: "原", pattern: "原油", type: "prefix" },
  { surname: "原", pattern: "原作", type: "prefix" },
  { surname: "原", pattern: "原著", type: "prefix" },
  { surname: "原", pattern: "原典", type: "prefix" },
  { surname: "原", pattern: "原液", type: "prefix" },
  { surname: "原", pattern: "原色", type: "prefix" },

  // 関
  { surname: "関", pattern: "関係", type: "prefix" },
  { surname: "関", pattern: "関数", type: "prefix" },
  { surname: "関", pattern: "関連", type: "prefix" },
  { surname: "関", pattern: "関心", type: "prefix" },
  { surname: "関", pattern: "関与", type: "prefix" },
  { surname: "関", pattern: "関西", type: "prefix" },
  { surname: "関", pattern: "関東", type: "prefix" },
  { surname: "関", pattern: "関税", type: "prefix" },
  { surname: "関", pattern: "関門", type: "prefix" },
  { surname: "関", pattern: "関節", type: "prefix" },
  { surname: "関", pattern: "関する", type: "prefix" },

  // 東
  { surname: "東", pattern: "東京", type: "prefix" },
  { surname: "東", pattern: "東海", type: "prefix" },
  { surname: "東", pattern: "東北", type: "prefix" },
  { surname: "東", pattern: "東側", type: "prefix" },
  { surname: "東", pattern: "東西", type: "prefix" },
  { surname: "東", pattern: "東南", type: "prefix" },
  { surname: "東", pattern: "東口", type: "prefix" },
  { surname: "東", pattern: "東部", type: "prefix" },
  { surname: "東", pattern: "東方", type: "prefix" },
  { surname: "東", pattern: "東洋", type: "prefix" },
  { surname: "東", pattern: "東面", type: "prefix" },
  { surname: "東", pattern: "東棟", type: "prefix" },
  { surname: "東", pattern: "東地区", type: "literal" },
  { surname: "東", pattern: "東端", type: "prefix" },
  { surname: "東", pattern: "東岸", type: "prefix" },

  // 南
  { surname: "南", pattern: "南側", type: "prefix" },
  { surname: "南", pattern: "南北", type: "prefix" },
  { surname: "南", pattern: "南東", type: "prefix" },
  { surname: "南", pattern: "南西", type: "prefix" },
  { surname: "南", pattern: "南口", type: "prefix" },
  { surname: "南", pattern: "南部", type: "prefix" },
  { surname: "南", pattern: "南方", type: "prefix" },
  { surname: "南", pattern: "南面", type: "prefix" },
  { surname: "南", pattern: "南棟", type: "prefix" },
  { surname: "南", pattern: "南地区", type: "literal" },
  { surname: "南", pattern: "南端", type: "prefix" },
  { surname: "南", pattern: "南岸", type: "prefix" },
  { surname: "南", pattern: "南海", type: "prefix" },
  { surname: "南", pattern: "南極", type: "prefix" },
  { surname: "南", pattern: "南米", type: "prefix" },
  { surname: "南", pattern: "南欧", type: "prefix" },
  { surname: "南", pattern: "日本の南", type: "literal" },

  // 岡
  { surname: "岡", pattern: "岡山", type: "prefix" },
  { surname: "岡", pattern: "岡の上", type: "literal" },
  { surname: "岡", pattern: "岡を越", type: "prefix" },
  { surname: "岡", pattern: "岡に建", type: "prefix" },

  // 堀
  { surname: "堀", pattern: "外堀", type: "literal" },
  { surname: "堀", pattern: "内堀", type: "literal" },
  { surname: "堀", pattern: "堀割", type: "prefix" },
  { surname: "堀", pattern: "堀端", type: "prefix" },
  { surname: "堀", pattern: "堀川", type: "prefix" },
  { surname: "堀", pattern: "城の堀", type: "literal" },
  { surname: "堀", pattern: "堀を埋", type: "prefix" },
  { surname: "堀", pattern: "堀を掘", type: "prefix" },
  { surname: "堀", pattern: "堀に水", type: "prefix" },
  { surname: "堀", pattern: "堀について", type: "literal" },

  // 辻
  { surname: "辻", pattern: "辻褄", type: "prefix" },
  { surname: "辻", pattern: "辻堂", type: "prefix" },
  { surname: "辻", pattern: "辻説法", type: "literal" },
  { surname: "辻", pattern: "辻斬り", type: "prefix" },
  { surname: "辻", pattern: "辻番", type: "prefix" },
  { surname: "辻", pattern: "道の辻", type: "literal" },
  { surname: "辻", pattern: "辻に立", type: "prefix" },
  { surname: "辻", pattern: "辻で", type: "prefix" },
  { surname: "辻", pattern: "辻があります", type: "literal" },
  { surname: "辻", pattern: "辻に", type: "prefix" },

  // 林
  { surname: "林", pattern: "林業", type: "prefix" },
  { surname: "林", pattern: "林道", type: "prefix" },
  { surname: "林", pattern: "林野", type: "prefix" },
  { surname: "林", pattern: "林地", type: "prefix" },
  { surname: "林", pattern: "林間", type: "prefix" },
  { surname: "林", pattern: "林床", type: "prefix" },
  { surname: "林", pattern: "林冠", type: "prefix" },
  { surname: "林", pattern: "林檎", type: "prefix" },
  { surname: "林", pattern: "山林", type: "literal" },
  { surname: "林", pattern: "竹林", type: "literal" },
  { surname: "林", pattern: "森林", type: "literal" },
  { surname: "林", pattern: "林の中", type: "literal" },
  { surname: "林", pattern: "林を歩", type: "prefix" },
  { surname: "林", pattern: "林に入", type: "prefix" },
] as const;
