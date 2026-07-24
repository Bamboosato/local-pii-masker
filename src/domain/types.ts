import type { DetectionNormalizationRule } from "./normalization/detection/types";

export type MaskCategory =
  | "PERSON"
  | "ADDRESS"
  | "ORGANIZATION"
  | "PHONE"
  | "EMAIL"
  | "POSTAL_CODE"
  | "SECRET"
  | "OTHER";

export type DetectionSource = "regex" | "ner" | "manual";

export type OccurrenceMaskingMode =
  | "global"
  | "contextual_ambiguous_surnames";

/** The application uses contextual occurrence masking for every session. */
export const FIXED_OCCURRENCE_MASKING_MODE: OccurrenceMaskingMode =
  "contextual_ambiguous_surnames";

export type ReviewStatus = "unreviewed" | "approved" | "excluded";

export type MaskEntry = {
  id: string;
  originalText: string;
  normalizedText: string;
  token: string;
  category: MaskCategory;
  sources: DetectionSource[];
  confidence?: number;
  normalizationRules?: DetectionNormalizationRule[];
  enabled: boolean;
  occurrenceCount: number;
  reviewStatus: ReviewStatus;
  displayOrder: number;
  manuallyPromotedAt?: number;
};

export type MaskSession = {
  originalText: string;
  entries: MaskEntry[];
  externalResponse: string;
  occurrenceMaskingMode: OccurrenceMaskingMode;
};

export const MASK_CATEGORIES: MaskCategory[] = [
  "PERSON",
  "ADDRESS",
  "ORGANIZATION",
  "PHONE",
  "EMAIL",
  "POSTAL_CODE",
  "SECRET",
  "OTHER",
];

export const CATEGORY_LABELS: Record<MaskCategory, string> = {
  PERSON: "人名",
  ADDRESS: "住所",
  ORGANIZATION: "組織",
  PHONE: "電話番号",
  EMAIL: "メール",
  POSTAL_CODE: "郵便番号",
  SECRET: "機密",
  OTHER: "その他",
};

export const SOURCE_LABELS: Record<DetectionSource, string> = {
  regex: "形式",
  ner: "AI検出",
  manual: "手動",
};

export const NORMALIZATION_RULE_LABELS: Record<
  DetectionNormalizationRule,
  string
> = {
  address_line_break: "住所改行結合",
  email_at_spacing: "@周辺空白補正",
  email_line_break: "メール改行結合",
  fullwidth_ascii: "全角文字補正",
  hyphen_variants: "ハイフン補正",
  japanese_inter_character_space: "氏名空白補正",
  line_end_hyphen: "行末ハイフン継続",
  person_name_line_break: "氏名改行結合",
  organization_line_break: "組織改行結合",
  phone_line_break: "電話番号改行結合",
  url_line_break: "URL改行結合",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  unreviewed: "未確認",
  approved: "有効",
  excluded: "無効",
};
