import { describe, expect, it } from "vitest";
import type { MaskEntry, ReviewStatus } from "../types";
import { buildHighlightSegments } from "./highlightText";

function entry(
  originalText: string,
  id: string,
  options: { enabled?: boolean; reviewStatus?: ReviewStatus } = {},
): MaskEntry {
  return {
    id,
    originalText,
    normalizedText: originalText.normalize("NFC"),
    token: `[${id}]`,
    category: "PERSON",
    sources: ["manual"],
    enabled: options.enabled ?? false,
    occurrenceCount: 0,
    reviewStatus: options.reviewStatus ?? "unreviewed",
    displayOrder: 0,
  };
}

describe("buildHighlightSegments", () => {
  it("未確認候補も原文上でハイライト対象にする", () => {
    expect(buildHighlightSegments("山田太郎です", [entry("山田太郎", "entry-1")])).toEqual([
      {
        enabled: false,
        end: 4,
        entryId: "entry-1",
        reviewStatus: "unreviewed",
        start: 0,
        type: "highlight",
        value: "山田太郎",
      },
      { end: 6, start: 4, type: "text", value: "です" },
    ]);
  });

  it("同じ位置では長い候補を優先して、短い候補を重ねない", () => {
    expect(
      buildHighlightSegments("山田さんと山田太郎さん", [
        entry("山田", "entry-short"),
        entry("山田太郎", "entry-long"),
      ]),
    ).toEqual([
      expect.objectContaining({ entryId: "entry-short", value: "山田" }),
      expect.objectContaining({ type: "text", value: "さんと" }),
      expect.objectContaining({ entryId: "entry-long", value: "山田太郎" }),
      expect.objectContaining({ type: "text", value: "さん" }),
    ]);
  });

  it("有効化済みと無効化済みの状態をセグメントに保持する", () => {
    const segments = buildHighlightSegments("佐藤さんと山田さん", [
      entry("佐藤", "approved", { enabled: true, reviewStatus: "approved" }),
      entry("山田", "disabled", { enabled: false, reviewStatus: "approved" }),
    ]);

    expect(segments).toEqual([
      expect.objectContaining({
        enabled: true,
        entryId: "approved",
        reviewStatus: "approved",
      }),
      expect.objectContaining({ type: "text", value: "さんと" }),
      expect.objectContaining({
        enabled: false,
        entryId: "disabled",
        reviewStatus: "approved",
      }),
      expect.objectContaining({ type: "text", value: "さん" }),
    ]);
  });
});
