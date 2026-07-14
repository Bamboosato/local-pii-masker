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

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  unreviewed: "未確認",
  approved: "有効",
  excluded: "無効",
};
