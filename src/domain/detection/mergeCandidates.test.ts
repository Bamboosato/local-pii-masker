import { describe, expect, it } from "vitest";
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
      reviewStatus: "unreviewed",
      enabled: false,
      displayOrder: 0,
    });
    expect(entries[1]).toMatchObject({
      originalText: "yamada@example.com",
      sources: ["regex"],
      occurrenceCount: 1,
      displayOrder: 1,
    });
  });
});
