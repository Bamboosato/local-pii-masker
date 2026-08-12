import { describe, expect, it } from "vitest";
import { inspectTokens } from "./inspectTokens";
import { restoreText } from "./restoreText";

const entries = [
  { token: "[人名_1]", restorationText: "山田太郎" },
  { token: "[電話番号_1]", restorationText: "090-1234-5678" },
];

describe("restoreText", () => {
  it("既知トークンが複数回出現する場合はすべて復元する", () => {
    expect(restoreText("[人名_1]です。[人名_1]宛です。", entries)).toBe(
      "山田太郎です。山田太郎宛です。",
    );
  });

  it("同一人物として関連付けた同じトークンを検査結果で重複させない", () => {
    expect(
      inspectTokens("[人名_1]", [
        { token: "[人名_1]" },
        { token: "[人名_1]" },
      ]),
    ).toEqual({
      knownPresent: ["[人名_1]"],
      absent: [],
      unknown: [],
    });
  });

  it("検出補正後の復元文字列を同一トークンの全出現へ使用する", () => {
    expect(
      restoreText("[メール_1] と [メール_1]", [
        {
          token: "[メール_1]",
          restorationText: "taro.yamada@example.co.jp",
        },
      ]),
    ).toBe("taro.yamada@example.co.jp と taro.yamada@example.co.jp");
  });

  it("既知、不明、未出現トークンを分類する", () => {
    const inspection = inspectTokens("[人名_1] と [住所_9]", entries);

    expect(inspection.knownPresent).toEqual(["[人名_1]"]);
    expect(inspection.absent).toEqual(["[電話番号_1]"]);
    expect(inspection.unknown).toEqual(["[住所_9]"]);
  });

  it("Markdownリンクの二重角括弧を不明トークンとして数えない", () => {
    const inspection = inspectTokens(
      "[[メール_1]](mailto:[メール_1])",
      [{ token: "[メール_1]" }],
    );

    expect(inspection.knownPresent).toEqual(["[メール_1]"]);
    expect(inspection.unknown).toEqual([]);
  });
});
