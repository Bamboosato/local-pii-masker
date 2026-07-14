import { describe, expect, it } from "vitest";
import { runRegexDetection } from "./runRegexDetection";

describe("runRegexDetection", () => {
  it("メール、電話番号、郵便番号を形式検出候補として返す", () => {
    const candidates = runRegexDetection(
      "連絡先は yamada@example.com、090-1234-5678、〒123-4567 です。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "yamada@example.com",
        category: "EMAIL",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "090-1234-5678",
        category: "PHONE",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "〒123-4567",
        category: "POSTAL_CODE",
        source: "regex",
      }),
    ]);
  });

  it("メール末尾の句読点や括弧を候補に含めない", () => {
    const candidates = runRegexDetection(
      "宛先は（support@example.co.jp）。確認してください。",
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      originalText: "support@example.co.jp",
      start: 4,
      end: 25,
    });
  });

  it("@前後に空白があるメールを原文表記と位置を保持して検出する", () => {
    const expectedEmails = [
      "taro.yamada @example.co.jp",
      "taro.yamada@ example.co.jp",
      "taro.yamada　@　example.co.jp",
    ];
    const sourceText = [
      expectedEmails[0],
      expectedEmails[1],
      "```text",
      expectedEmails[2],
      "```",
    ].join("\n");

    const emailCandidates = runRegexDetection(sourceText).filter(
      (candidate) => candidate.category === "EMAIL",
    );

    expect(emailCandidates.map((candidate) => candidate.originalText)).toEqual(
      expectedEmails,
    );
    expect(
      emailCandidates.every(
        ({ start, end, originalText }) =>
          start !== undefined &&
          end !== undefined &&
          sourceText.slice(start, end) === originalText,
      ),
    ).toBe(true);
    expect(
      emailCandidates.every((candidate) =>
        candidate.normalizationRules?.includes("email_at_spacing"),
      ),
    ).toBe(true);
  });

  it("メール形式ではない@周辺の通常文は候補にしない", () => {
    expect(runRegexDetection("担当者 A @ B と相談した。")).toEqual([]);
  });

  it("全角数字と全角ハイフンの電話番号・郵便番号を表記維持で検出する", () => {
    const candidates = runRegexDetection(
      "電話：０９０－１２３４－５６７８ 郵便：１２３－４５６７",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "０９０－１２３４－５６７８",
        category: "PHONE",
      }),
      expect.objectContaining({
        originalText: "１２３－４５６７",
        category: "POSTAL_CODE",
      }),
    ]);
  });

  it("日付や桁数が不足する電話番号を候補にしない", () => {
    const candidates = runRegexDetection(
      "日付は2026-07-10、短い番号は03-12-345です。",
    );

    expect(candidates).toEqual([]);
  });

  it("一般的なメール形式から外れるドメインは候補にしない", () => {
    const candidates = runRegexDetection(
      "候補外は user@example.c と user@example.123 です。",
    );

    expect(candidates).toEqual([]);
  });

  it("httpまたはhttpsのURLを末尾記号を除いて検出する", () => {
    const candidates = runRegexDetection(
      "参照先は（https://dev.orion.example.jp/login?from=test#top）。APIはhttp://localhost:5173/pathです。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "https://dev.orion.example.jp/login?from=test#top",
        category: "OTHER",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "http://localhost:5173/path",
        category: "OTHER",
        source: "regex",
      }),
    ]);
  });

  it("スキームなしドメインと不完全なURLは候補にしない", () => {
    const candidates = runRegexDetection(
      "候補外は example.jp/path、https://、https://invalid です。",
    );

    expect(candidates).toEqual([]);
  });

  it("URL内のIPアドレスはURLとは別の候補にしない", () => {
    const candidates = runRegexDetection(
      "管理画面はhttps://192.0.2.10/path、接続元は192.0.2.11です。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "https://192.0.2.10/path",
        category: "OTHER",
      }),
      expect.objectContaining({
        originalText: "192.0.2.11",
        category: "OTHER",
      }),
    ]);
  });

  it("明示ラベル付きのユーザーIDとパスワードを機密候補にする", () => {
    const candidates = runRegexDetection(
      "ユーザーID「test.yamada」、パスワード「TempPass-2026!」です。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "test.yamada",
        category: "SECRET",
        source: "regex",
      }),
      expect.objectContaining({
        originalText: "TempPass-2026!",
        category: "SECRET",
        source: "regex",
      }),
    ]);
  });

  it("生年月日ラベルに続く年月日の部分だけを候補にする", () => {
    const candidates = runRegexDetection(
      "生年月日「1985年4月12日」、次回面談日は2026年7月15日です。",
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "1985年4月12日",
        category: "OTHER",
        source: "regex",
      }),
    ]);
  });

  it("市区町村と番地表現を含む日本語住所全体を検出する", () => {
    const candidates = runRegexDetection(
      [
        "住所東京都新宿区西新宿二丁目8番1号という記録がある。",
        "所在地は愛知県豊田市若宮町二丁目15番地です。",
        "愛知県名古屋市中村区名駅四丁目7番1号 ミッドタワー名駅18階、",
        "名古屋市中区栄三丁目12番8号で開催する。",
      ].join(""),
    );

    expect(
      candidates
        .filter((candidate) => candidate.category === "ADDRESS")
        .map((candidate) => candidate.originalText),
    ).toEqual([
      "東京都新宿区西新宿二丁目8番1号",
      "愛知県豊田市若宮町二丁目15番地",
      "愛知県名古屋市中村区名駅四丁目7番1号 ミッドタワー名駅18階",
      "名古屋市中区栄三丁目12番8号",
    ]);
  });

  it("番地表現のない地名や一般文は住所候補にしない", () => {
    const candidates = runRegexDetection(
      "会議は名古屋市中区で開催し、担当者は東京都へ移動する。",
    );

    expect(candidates.some((candidate) => candidate.category === "ADDRESS")).toBe(
      false,
    );
  });

  it("自宅住所・登録住所・配送先などの文脈ラベルを住所候補に含めない", () => {
    const address = "愛知県豊田市若宮町二丁目15番地";
    const homeAddress = "愛知県名古屋市千種区星が丘元町5番20号";
    const candidates = runRegexDetection(
      [
        `登録住所は${address}。`,
        `配送先は${address}。`,
        `登録住所 ： ${address}。`,
        `自宅住所は${homeAddress}。`,
        `自宅住所 ： ${homeAddress}。`,
        "所在地は愛知県豊田市登録町二丁目15番地。",
      ].join(""),
    );

    expect(
      candidates
        .filter((candidate) => candidate.category === "ADDRESS")
        .map((candidate) => candidate.originalText),
    ).toEqual([
      address,
      address,
      address,
      homeAddress,
      homeAddress,
      "愛知県豊田市登録町二丁目15番地",
    ]);
  });

  it("NERで漏れやすい文脈付きの日本語姓名と英字名義人を補助検出する", () => {
    const candidates = runRegexDetection(
      [
        "品質管理担当の佐藤健一、外部協力会社である合同会社みらいテクノロジーの鈴木一郎である。",
        "顧客である田中美咲から問い合わせを受けた。",
        "別のテストデータには、氏名佐藤健一、住所東京都新宿区西新宿二丁目8番1号という記録も存在した。",
        "カード名義人TARO YAMADAが使用された。",
      ].join(""),
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalText: "佐藤健一",
          category: "PERSON",
          source: "regex",
        }),
        expect.objectContaining({
          originalText: "鈴木一郎",
          category: "PERSON",
          source: "regex",
        }),
        expect.objectContaining({
          originalText: "田中美咲",
          category: "PERSON",
          source: "regex",
        }),
        expect.objectContaining({
          originalText: "TARO YAMADA",
          category: "PERSON",
          source: "regex",
        }),
      ]),
    );
  });

  it("明示ラベル付きのTitle Case・全大文字英語氏名だけを補助検出する", () => {
    const candidates = runRegexDetection(
      [
        "氏名Taro Yamada、口座名義：JANE DOEです。",
        "Taro YamadaとProject Orionは文脈のない単独表記です。",
      ].join("\n"),
    );

    expect(
      candidates
        .filter((candidate) => candidate.category === "PERSON")
        .map((candidate) => candidate.originalText),
    ).toEqual(["Taro Yamada", "JANE DOE"]);
  });

  it("文脈付き姓名の半角・全角空白を候補文字列として保持する", () => {
    const sourceText =
      "顧客である田中 美咲から連絡があり、氏名　田中　美咲と記録した。";
    const candidates = runRegexDetection(sourceText);

    expect(
      candidates
        .filter((candidate) => candidate.category === "PERSON")
        .map((candidate) => candidate.originalText),
    ).toEqual(["田中 美咲", "田中　美咲"]);
    expect(
      candidates
        .filter((candidate) => candidate.category === "PERSON")
        .map(({ start, end }) => sourceText.slice(start, end)),
    ).toEqual(["田中 美咲", "田中　美咲"]);
  });

  it("一覧中の空白区切り姓名を文脈語がなくても補助検出する", () => {
    const sourceText = "参加者は田中 美咲、鈴木　一郎です。";
    const candidates = runRegexDetection(sourceText);

    expect(
      candidates
        .filter((candidate) => candidate.category === "PERSON")
        .map((candidate) => candidate.originalText),
    ).toEqual(["田中 美咲", "鈴木　一郎"]);
  });

  it("OCR空白で名が分割されても途中で打ち切らず氏名全体を保持する", () => {
    const sourceText = [
      "山田　太 郎",
      "山田　太　郎",
      "氏名：山田 太 郎です。",
      "山田 翔 営業部",
    ].join("\n");
    const personCandidates = runRegexDetection(sourceText).filter(
      (candidate) => candidate.category === "PERSON",
    );

    expect(personCandidates.map((candidate) => candidate.originalText)).toEqual([
      "山田　太 郎",
      "山田　太　郎",
      "山田 太 郎",
      "山田 翔",
    ]);
    expect(
      personCandidates.map(({ start, end }) => sourceText.slice(start, end)),
    ).toEqual(personCandidates.map((candidate) => candidate.originalText));
    expect(
      personCandidates.some((candidate) =>
        ["山田　太", "山田 太"].includes(candidate.originalText),
      ),
    ).toBe(false);
  });

  it("文脈のない住所・部署らしい語は人名補助検出しない", () => {
    const candidates = runRegexDetection(
      "会社所在地は愛知県名古屋市中村区名駅四丁目7番1号です。営業企画部は会議に参加した。",
    );

    expect(candidates.some((candidate) => candidate.category === "PERSON")).toBe(
      false,
    );
  });
});
