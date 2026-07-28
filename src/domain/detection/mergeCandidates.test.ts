import { describe, expect, it } from "vitest";
import { maskText } from "../mask/maskText";
import { detectOrganizationsWithNormalization } from "./regex/detectOrganizationsWithNormalization";
import { mergeCandidates } from "./mergeCandidates";

describe("mergeCandidates", () => {
  it("regex、NER、manual の同一文字列候補を1項目へ統合し、検出元を保持する", () => {
    let id = 0;
    const entries = mergeCandidates({
      originalText: "山田太郎のメールは yamada@example.com です。山田太郎です。",
      entries: [],
      candidates: [
        {
          originalText: "山田太郎",
          category: "PERSON",
          source: "ner",
          confidence: 0.91,
        },
        {
          originalText: "山田太郎",
          category: "PERSON",
          source: "manual",
        },
        {
          originalText: "yamada@example.com",
          category: "EMAIL",
          source: "regex",
        },
      ],
      createId: () => `entry-${(id += 1)}`,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      originalText: "山田太郎",
      sources: ["ner", "manual"],
      occurrenceCount: 2,
      reviewStatus: "approved",
      enabled: true,
      displayOrder: 0,
    });
    expect(entries[1]).toMatchObject({
      originalText: "yamada@example.com",
      sources: ["regex"],
      occurrenceCount: 1,
      displayOrder: 1,
    });
  });

  it("現在の原文に存在しない自動検出候補は新規作成しない", () => {
    const entries = mergeCandidates({
      originalText: "山田太郎さんに連絡する。",
      entries: [],
      candidates: [
        {
          originalText: "佐藤山田太郎山田花子鈴木一郎",
          category: "PERSON",
          source: "ner",
          confidence: 1,
        },
        {
          originalText: "山田太郎",
          category: "PERSON",
          source: "ner",
          confidence: 0.91,
        },
      ],
      createId: () => "entry-1",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      originalText: "山田太郎",
      occurrenceCount: 1,
    });
  });

  it("手動追加済み住所の設定を維持して形式検出元だけを追加する", () => {
    const address = "愛知県豊田市若宮町二丁目15番地";
    const entries = mergeCandidates({
      originalText: `${address}へ送付する。`,
      entries: [
        {
          id: "manual-address",
          originalText: address,
          normalizedText: address,
          restorationText: address,
          token: "[機密_1]",
          category: "SECRET",
          sources: ["manual"],
          enabled: true,
          occurrenceCount: 1,
          reviewStatus: "approved",
          displayOrder: 0,
        },
      ],
      candidates: [
        {
          originalText: address,
          category: "ADDRESS",
          source: "regex",
        },
      ],
      createId: () => "unused",
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "manual-address",
        category: "SECRET",
        token: "[機密_1]",
        sources: ["manual", "regex"],
        enabled: true,
        reviewStatus: "approved",
      }),
    ]);
  });

  it("無効化済みの対象を再検出してもユーザーの無効設定を維持する", () => {
    const entries = mergeCandidates({
      originalText: "連絡先は yamada@example.com です。",
      entries: [
        {
          id: "email-1",
          originalText: "yamada@example.com",
          normalizedText: "yamada@example.com",
          restorationText: "yamada@example.com",
          token: "[メール_1]",
          category: "EMAIL",
          sources: ["regex"],
          enabled: false,
          occurrenceCount: 1,
          reviewStatus: "approved",
          displayOrder: 0,
        },
      ],
      candidates: [
        {
          originalText: "yamada@example.com",
          category: "EMAIL",
          source: "regex",
        },
      ],
      createId: () => "unused",
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "email-1",
        enabled: false,
        reviewStatus: "approved",
        occurrenceCount: 1,
      }),
    ]);
  });

  it("旧仕様の未確認対象は再検出時に有効状態へ移行する", () => {
    const entries = mergeCandidates({
      originalText: "連絡先は yamada@example.com です。",
      entries: [
        {
          id: "legacy-email",
          originalText: "yamada@example.com",
          normalizedText: "yamada@example.com",
          restorationText: "yamada@example.com",
          token: "[メール_1]",
          category: "EMAIL",
          sources: ["regex"],
          enabled: false,
          occurrenceCount: 1,
          reviewStatus: "unreviewed",
          displayOrder: 0,
        },
      ],
      candidates: [
        {
          originalText: "yamada@example.com",
          category: "EMAIL",
          source: "regex",
        },
      ],
      createId: () => "unused",
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "legacy-email",
        enabled: true,
        reviewStatus: "approved",
      }),
    ]);
  });

  it("正規化メールは空白込みの原文表記と適用ルールを保持して全箇所をマスクする", () => {
    const email = "taro.yamada @ example.co.jp";
    const originalText = `送信先は${email}です。再送先も${email}です。`;
    const entries = mergeCandidates({
      originalText,
      entries: [],
      candidates: [
        {
          originalText: email,
          restorationText: "taro.yamada@example.co.jp",
          category: "EMAIL",
          source: "regex",
          normalizationRules: ["email_at_spacing"],
        },
      ],
      createId: () => "normalized-email",
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "normalized-email",
        originalText: email,
        normalizedText: email,
        restorationText: "taro.yamada@example.co.jp",
        normalizationRules: ["email_at_spacing"],
        occurrenceCount: 2,
      }),
    ]);
    expect(maskText(originalText, entries)).toBe(
      "送信先は[メール_1]です。再送先も[メール_1]です。",
    );
  });

  it("組織改行の形式候補をNER候補と統合してもカテゴリとトークンを一致させる", () => {
    const originalText = "東海システム開発セン\nター";
    const [organizationCandidate] =
      detectOrganizationsWithNormalization(originalText);
    const entries = mergeCandidates({
      originalText,
      entries: [],
      candidates: [
        organizationCandidate,
        {
          originalText,
          category: "ORGANIZATION",
          source: "ner",
          confidence: 0.77,
        },
      ],
      createId: () => "organization-1",
    });

    expect(entries).toEqual([
      expect.objectContaining({
        category: "ORGANIZATION",
        token: "[組織_1]",
        sources: ["regex", "ner"],
        normalizationRules: ["organization_line_break"],
        restorationText: "東海システム開発センター",
      }),
    ]);
  });

  it("補正後候補を未補正候補より優先し、低優先度の候補では上書きしない", () => {
    const originalText = "山田\n太郎";
    const entries = mergeCandidates({
      originalText,
      entries: [],
      candidates: [
        {
          originalText,
          category: "PERSON",
          source: "ner",
        },
        {
          originalText,
          restorationText: "山田太郎",
          category: "PERSON",
          source: "regex",
          normalizationRules: ["person_name_line_break"],
        },
        {
          originalText,
          restorationText: "誤った復元値",
          category: "PERSON",
          source: "ner",
          normalizationRules: ["person_name_line_break"],
        },
      ],
      createId: () => "person-1",
    });

    expect(entries[0]).toMatchObject({
      originalText,
      restorationText: "山田太郎",
      sources: ["ner", "regex"],
    });
  });

  it("再検出時は確定済みの同優先度復元値を維持する", () => {
    const originalText = "株式会社\n青葉";
    const entries = mergeCandidates({
      originalText,
      entries: [
        {
          id: "organization-1",
          originalText,
          normalizedText: originalText,
          restorationText: "株式会社青葉",
          token: "[組織_1]",
          category: "ORGANIZATION",
          sources: ["regex"],
          normalizationRules: ["organization_line_break"],
          enabled: true,
          occurrenceCount: 1,
          reviewStatus: "approved",
          displayOrder: 0,
        },
      ],
      candidates: [
        {
          originalText,
          restorationText: "異なる株式会社青葉",
          category: "ORGANIZATION",
          source: "regex",
          normalizationRules: ["organization_line_break"],
        },
      ],
      createId: () => "unused",
    });

    expect(entries[0].restorationText).toBe("株式会社青葉");
  });
});
