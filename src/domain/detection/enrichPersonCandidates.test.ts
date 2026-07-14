import { describe, expect, it } from "vitest";
import type { DetectionCandidate } from "./mergeCandidates";
import { enrichPersonCandidates } from "./enrichPersonCandidates";

describe("enrichPersonCandidates", () => {
  it("異なるフルネームが共有する姓の独立出現を候補にする", () => {
    const sourceText = "山田太郎と山田花子に確認し、山田は承認した。";
    const candidates = createPersonCandidates(sourceText, [
      "山田太郎",
      "山田花子",
    ]);

    const enriched = enrichPersonCandidates(sourceText, candidates);
    const surnameCandidate = enriched.find(
      (candidate) => candidate.originalText === "山田",
    );

    expect(surnameCandidate).toEqual({
      originalText: "山田",
      category: "PERSON",
      source: "regex",
      start: sourceText.lastIndexOf("山田"),
      end: sourceText.lastIndexOf("山田") + 2,
    });
  });

  it("1件の検出済みフルネームを根拠に独立した姓を候補にする", () => {
    const sourceText = "山田太郎に確認し、山田は承認した。";
    const candidates = createPersonCandidates(sourceText, ["山田太郎"]);

    expect(
      enrichPersonCandidates(sourceText, candidates).some(
        (candidate) => candidate.originalText === "山田",
      ),
    ).toBe(true);
  });

  it("既知の姓名と単独姓を根拠にMarkdown内の同姓別姓名と姓を補完する", () => {
    const sourceText = [
      "障害対応責任者は高橋健太である。",
      "高橋は確認した。",
      "別資料には",
      "```",
      "高橋由美",
      "```",
      "という記載がある。",
      "```",
      "高橋",
      "高橋健太",
      "高橋由美",
      "```",
    ].join("\n");
    const candidates = createPersonCandidates(sourceText, ["高橋健太"]);

    const enriched = enrichPersonCandidates(sourceText, candidates);

    expect(enriched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalText: "高橋由美",
          category: "PERSON",
          source: "regex",
          start: sourceText.indexOf("高橋由美"),
        }),
        expect.objectContaining({
          originalText: "高橋",
          category: "PERSON",
          source: "regex",
          start: sourceText.indexOf("高橋は"),
        }),
      ]),
    );
  });

  it("単独姓がない場合はMarkdown内の同姓らしい文字列を補完しない", () => {
    const sourceText = [
      "障害対応責任者は高橋健太である。",
      "```",
      "高橋由美",
      "```",
    ].join("\n");
    const candidates = createPersonCandidates(sourceText, ["高橋健太"]);

    const enriched = enrichPersonCandidates(sourceText, candidates);

    expect(enriched).toEqual(candidates);
  });

  it("共有姓が原文中に単独で存在しなければ候補を派生しない", () => {
    const sourceText = "山田太郎と山田花子に確認した。";
    const candidates = createPersonCandidates(sourceText, [
      "山田太郎",
      "山田花子",
    ]);

    expect(enrichPersonCandidates(sourceText, candidates)).toEqual(candidates);
  });

  it("同じ姓で始まる非人名複合語があっても姓候補を派生する", () => {
    const sourceText =
      "山田太郎に確認し、山田は承認した。山田製作所と山田線にも連絡した。";
    const candidates = createPersonCandidates(sourceText, ["山田太郎"]);

    expect(
      enrichPersonCandidates(sourceText, candidates).some(
        (candidate) => candidate.originalText === "山田",
      ),
    ).toBe(true);
  });

  it("1文字姓はフルネームを検出済みでも自動派生しない", () => {
    const sourceText = "森太郎に確認し、森は承認した。";
    const candidates = createPersonCandidates(sourceText, ["森太郎"]);

    expect(
      enrichPersonCandidates(sourceText, candidates).some(
        (candidate) => candidate.originalText === "森",
      ),
    ).toBe(false);
  });

  it("AI検出した姓名と同じ文字列になる1文字空白入り表記を補完する", () => {
    const spacedNames = [
      "山 田 太 郎",
      "山　田　太　郎",
      "山 田　太郎",
      "山　田太　郎",
    ];
    const sourceText = ["山田太郎を担当者として登録した。", ...spacedNames].join(
      "\n",
    );
    const candidates = createPersonCandidates(sourceText, ["山田太郎"]);

    const derived = enrichPersonCandidates(sourceText, candidates).filter(
      (candidate) => candidate.source === "regex",
    );

    expect(derived.map((candidate) => candidate.originalText)).toEqual(
      spacedNames,
    );
    expect(
      derived.every(
        ({ start, end, originalText }) =>
          start !== undefined &&
          end !== undefined &&
          sourceText.slice(start, end) === originalText,
      ),
    ).toBe(true);
  });

  it("AI検出以外の姓名候補だけでは空白入り表記を補完しない", () => {
    const sourceText = "山田太郎と山 田 太 郎を記載した。";
    const regexCandidate = {
      ...createPersonCandidates(sourceText, ["山田太郎"])[0],
      source: "regex" as const,
    };

    expect(enrichPersonCandidates(sourceText, [regexCandidate])).toEqual([
      regexCandidate,
    ]);
  });

  it("同じ空白入り表記を形式検出済みの場合は重複して補完しない", () => {
    const sourceText = "山田太郎と山田　太 郎を記載した。";
    const nerCandidate = createPersonCandidates(sourceText, ["山田太郎"])[0];
    const originalText = "山田　太 郎";
    const start = sourceText.indexOf(originalText);
    const regexCandidate: DetectionCandidate = {
      originalText,
      category: "PERSON",
      source: "regex",
      start,
      end: start + originalText.length,
    };

    expect(
      enrichPersonCandidates(sourceText, [nerCandidate, regexCandidate]),
    ).toEqual([nerCandidate, regexCandidate]);
  });

  it("空白2文字・タブ・改行・漢字語に埋め込まれた表記は補完しない", () => {
    const sourceText = [
      "山田太郎",
      "山  田 太 郎",
      "山\t田太郎",
      "山\n田太郎",
      "高山 田 太 郎",
      "山 田 太 郎介",
    ].join("\n");
    const candidates = createPersonCandidates(sourceText, ["山田太郎"]);

    expect(enrichPersonCandidates(sourceText, candidates)).toEqual(candidates);
  });
});

function createPersonCandidates(
  sourceText: string,
  names: string[],
): DetectionCandidate[] {
  return names.map((name) => {
    const start = sourceText.indexOf(name);

    return {
      originalText: name,
      category: "PERSON",
      source: "ner",
      start,
      end: start + name.length,
    };
  });
}
