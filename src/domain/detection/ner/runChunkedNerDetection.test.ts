import { describe, expect, it, vi } from "vitest";
import {
  NER_CHUNK_MAX_LENGTH,
  runChunkedNerDetection,
  splitTextForNer,
} from "./runChunkedNerDetection";

describe("splitTextForNer", () => {
  it("短文は分割せずそのまま返す", () => {
    expect(splitTextForNer("山田太郎さんに連絡する。")).toEqual([
      {
        start: 0,
        end: 12,
        text: "山田太郎さんに連絡する。",
      },
    ]);
  });

  it("長文を上限以内かつ重複付きで分割し、全文を覆う", () => {
    const sourceText = "0123456789ABCDEFGHIJ";
    const chunks = splitTextForNer(sourceText, { maxLength: 8, overlap: 2 });

    expect(chunks.every((chunk) => chunk.text.length <= 8)).toBe(true);
    expect(chunks[0]).toMatchObject({ start: 0, end: 8, text: "01234567" });
    expect(chunks.at(-1)?.end).toBe(sourceText.length);

    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].start).toBeLessThan(chunks[index - 1].end);
      expect(chunks[index].start).toBeGreaterThan(chunks[index - 1].start);
    }

    expect(
      Array.from(sourceText, (_, index) =>
        chunks.some((chunk) => chunk.start <= index && chunk.end > index),
      ).every(Boolean),
    ).toBe(true);
  });

  it("上限付近の文末を優先し、サロゲートペアを分断しない", () => {
    const sentenceChunks = splitTextForNer("12345。6789012345。XYZ", {
      maxLength: 10,
      overlap: 2,
    });
    const emojiChunks = splitTextForNer("1234567😀ABC", {
      maxLength: 8,
      overlap: 2,
    });

    expect(sentenceChunks[0].text).toBe("12345。");
    expect(emojiChunks.every((chunk) => !chunk.text.includes("�"))).toBe(true);
    expect(emojiChunks.map((chunk) => chunk.text).join("|")).toContain("😀");
  });

  it("不正な分割設定を拒否する", () => {
    expect(() => splitTextForNer("text", { maxLength: 1 })).toThrow(RangeError);
    expect(() =>
      splitTextForNer("text", { maxLength: 10, overlap: 10 }),
    ).toThrow(RangeError);
  });
});

describe("runChunkedNerDetection", () => {
  it("モデル上限を超える長文後半の候補を原文位置付きで返す", async () => {
    const sourceText = `${"前".repeat(NER_CHUNK_MAX_LENGTH * 2)}佐藤花子`;
    const classifier = vi.fn(async (chunkText: string) =>
      chunkText.includes("佐藤花子")
        ? [
            {
              entity_group: "PER",
              score: 0.94,
              word: "佐藤花子",
            },
          ]
        : [],
    );

    await expect(runChunkedNerDetection(sourceText, classifier)).resolves.toEqual([
      expect.objectContaining({
        originalText: "佐藤花子",
        category: "PERSON",
        start: NER_CHUNK_MAX_LENGTH * 2,
        end: NER_CHUNK_MAX_LENGTH * 2 + 4,
      }),
    ]);
    expect(classifier.mock.calls.length).toBeGreaterThan(1);
  });

  it("重複領域で同じ候補を検出しても1件へ統合する", async () => {
    const sourceText = `${"前".repeat(300)}山田太郎${"後".repeat(80)}`;
    let callCount = 0;
    const classifier = vi.fn(async (chunkText: string) => {
      if (!chunkText.includes("山田太郎")) {
        return [];
      }

      callCount += 1;
      const start = chunkText.indexOf("山田太郎");
      return [
        {
          entity_group: "PER",
          score: callCount === 1 ? 0.8 : 0.96,
          start,
          end: start + 4,
          word: "別文字列",
        },
      ];
    });

    await expect(runChunkedNerDetection(sourceText, classifier)).resolves.toEqual([
      expect.objectContaining({
        originalText: "山田太郎",
        confidence: 0.96,
        start: 300,
        end: 304,
      }),
    ]);
  });
});
