import { describe, expect, it } from "vitest";
import type { MaskEntry } from "../types";
import { createMaskMappingFingerprint, createMaskMappingSnapshot } from "./snapshot";
import { parseMaskMapping } from "./validate";
import { reapplyMaskMapping } from "./reapply";

function entry(overrides: Partial<MaskEntry> = {}): MaskEntry {
  return {
    id: "entry-1",
    originalText: "山田太郎",
    normalizedText: "山田太郎",
    restorationText: "山田太郎",
    token: "[人名_1]",
    category: "PERSON",
    sources: ["ner"],
    enabled: true,
    occurrenceCount: 2,
    reviewStatus: "approved",
    displayOrder: 0,
    ...overrides,
  };
}

describe("mask mapping snapshot", () => {
  it("有効な対応だけを安定した順序で保存し、原文や派生値を含めない", () => {
    const mapping = createMaskMappingSnapshot({
      mappingId: "mapping-1",
      name: "営業先",
      createdAt: 1,
      updatedAt: 2,
      revision: 0,
      occurrenceMaskingMode: "contextual_ambiguous_surnames",
      entries: [
        entry({ id: "entry-2", originalText: "東京", normalizedText: "東京", token: "[住所_1]", category: "ADDRESS", enabled: false }),
        entry(),
      ],
    });

    expect(mapping.entries).toHaveLength(1);
    expect(JSON.stringify(mapping)).not.toContain("occurrenceCount");
    expect(JSON.stringify(mapping)).not.toContain("maskedText");
    expect(JSON.stringify(mapping)).not.toContain("externalResponse");
    expect(mapping.entries[0]).toEqual(expect.objectContaining({
      targetText: "山田太郎",
      token: "[人名_1]",
      manual: false,
    }));
  });

  it("フィンガープリントは入力配列の順序に依存しない", () => {
    const first = entry();
    const second = entry({ id: "entry-2", originalText: "佐藤花子", normalizedText: "佐藤花子", token: "[人名_2]" });
    expect(createMaskMappingFingerprint([first, second], "contextual_ambiguous_surnames"))
      .toBe(createMaskMappingFingerprint([second, first], "contextual_ambiguous_surnames"));
  });

  it("対応表を新しい原文へ再適用し、出現数だけを再計算する", () => {
    const mapping = parseMaskMapping({
      schemaVersion: 1,
      mappingId: "mapping-1",
      name: "営業先",
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
      occurrenceMaskingMode: "contextual_ambiguous_surnames",
      entries: [{
        id: "entry-1",
        targetText: "山田太郎",
        normalizedTargetText: "山田太郎",
        token: "[人名_1]",
        restorationText: "山田太郎",
        category: "PERSON",
        sources: ["manual"],
        manual: true,
      }],
    });

    const reapplied = reapplyMaskMapping(mapping, "山田太郎さん、山田太郎さん");
    expect(reapplied[0]).toMatchObject({ occurrenceCount: 2, enabled: true, reviewStatus: "approved" });
    expect(reapplied[0]).not.toHaveProperty("start");
  });

  it("同一関連付けの対象は1つのトークンを共有できる", () => {
    expect(() => parseMaskMapping({
      schemaVersion: 1,
      mappingId: "mapping-1",
      name: "同一人物",
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
      occurrenceMaskingMode: "contextual_ambiguous_surnames",
      entries: [
        { id: "entry-1", targetText: "山田", normalizedTargetText: "山田", token: "[人名_1]", restorationText: "山田太郎", category: "PERSON", sources: ["manual"], relationId: "group-1", manual: true },
        { id: "entry-2", targetText: "山田太郎", normalizedTargetText: "山田太郎", token: "[人名_1]", restorationText: "山田太郎", category: "PERSON", sources: ["ner"], relationId: "group-1", manual: false },
      ],
    })).not.toThrow();
  });

  it("関連付けなしの同一トークンや、1対象への複数トークンを許可しない", () => {
    expect(() => parseMaskMapping({
      schemaVersion: 1,
      mappingId: "mapping-1",
      name: "不正",
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
      occurrenceMaskingMode: "contextual_ambiguous_surnames",
      entries: [
        { id: "entry-1", targetText: "山田", normalizedTargetText: "山田", token: "[人名_1]", restorationText: "山田", category: "PERSON", sources: ["manual"], manual: true },
        { id: "entry-2", targetText: "佐藤", normalizedTargetText: "佐藤", token: "[人名_1]", restorationText: "佐藤", category: "PERSON", sources: ["manual"], manual: true },
      ],
    })).toThrow("一意");

    expect(() => parseMaskMapping({
      schemaVersion: 1,
      mappingId: "mapping-1",
      name: "不正",
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
      occurrenceMaskingMode: "contextual_ambiguous_surnames",
      entries: [
        { id: "entry-1", targetText: "山田", normalizedTargetText: "山田", token: "[人名_1]", restorationText: "山田", category: "PERSON", sources: ["manual"], manual: true },
        { id: "entry-2", targetText: "山田", normalizedTargetText: "山田", token: "[人名_2]", restorationText: "山田", category: "PERSON", sources: ["manual"], manual: true },
      ],
    })).toThrow("一意");
  });
});
