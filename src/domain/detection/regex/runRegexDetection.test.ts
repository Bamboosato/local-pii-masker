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

  it("電話番号の先頭7桁を郵便番号候補として重複登録しない", () => {
    const candidates = runRegexDetection("連絡先は080-9876-5432です。");

    expect(candidates).toEqual([
      expect.objectContaining({
        originalText: "080-9876-5432",
        category: "PHONE",
        source: "regex",
      }),
    ]);
  });

  it("電話番号の途中改行を除去して原文範囲を候補化する", () => {
    const phoneValues = [
      "090-1234-\n5678",
      "052-\n123-4567",
      "080-9876-\n5432",
      "03-5123-\n8800",
    ];
    const sourceText = phoneValues.join("\n");
    const candidates = runRegexDetection(sourceText).filter(
      (candidate) => candidate.category === "PHONE",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual(
      phoneValues,
    );
    expect(
      candidates.every(
        ({ start, end, originalText }) =>
          start !== undefined &&
          end !== undefined &&
          sourceText.slice(start, end) === originalText,
      ),
    ).toBe(true);
    expect(
      candidates.every((candidate) =>
        candidate.normalizationRules?.includes("phone_line_break"),
      ),
    ).toBe(true);
    expect(
      runRegexDetection(sourceText).some(
        (candidate) => candidate.category === "POSTAL_CODE",
      ),
    ).toBe(false);
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

  it("途中改行された組織名をNER未検出でも形式候補にする", () => {
    const sourceText = [
      "株式会社青葉デジタルソリューショ\nンズ",
      "合同会社みらいテクノロ\nジー",
      "北星メディカル株式\n会社",
      "東海システム開発セン\nター",
    ].join("。\n");
    const candidates = runRegexDetection(sourceText).filter(
      (candidate) => candidate.category === "ORGANIZATION",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "株式会社青葉デジタルソリューショ\nンズ",
      "合同会社みらいテクノロ\nジー",
      "北星メディカル株式\n会社",
      "東海システム開発セン\nター",
    ]);
    expect(
      candidates.every(
        ({ start, end, originalText }) =>
          start !== undefined &&
          end !== undefined &&
          sourceText.slice(start, end) === originalText &&
          originalText.includes("\n"),
      ),
    ).toBe(true);
    expect(
      candidates.every((candidate) =>
        candidate.normalizationRules?.includes("organization_line_break"),
      ),
    ).toBe(true);
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

  it("姓リストにない名称でも担当者・責任者の文脈と敬称から検出する", () => {
    const sourceText =
      "担当者は田中さん、鬼頭さん、鬼頭君で伊藤さんが責任者です。";
    const candidates = runRegexDetection(sourceText)
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(candidates).toHaveLength(4);
    expect(candidates).toEqual(
      expect.arrayContaining(["田中さん", "鬼頭さん", "鬼頭君", "伊藤さん"]),
    );
  });

  it("名称の後ろに担当者・責任者が続く文脈でも敬称込みで検出する", () => {
    const candidates = runRegexDetection("鬼頭さんが責任者です。").filter(
      (candidate) => candidate.category === "PERSON",
    );

    expect(candidates.map((candidate) => candidate.originalText)).toEqual([
      "鬼頭さん",
    ]);
  });

  it("文脈のない姓リスト外の漢字列も敬称込みで検出する", () => {
    const candidates = runRegexDetection("鬼頭さんです。鬼頭君も参加します。")
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(candidates).toEqual(["鬼頭さん", "鬼頭君"]);
  });

  it("異体字の姓名を原文表記のまま検出する", () => {
    const sourceText =
      "氏名：髙橋 一郎、山﨑直子、渡邉美咲、渡邊健、齋藤太郎、齊藤花子、濱田次郎、濵田三郎、𠮷田健。";
    const candidates = runRegexDetection(sourceText)
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(candidates).toHaveLength(9);
    expect(candidates).toEqual(
      expect.arrayContaining([
      "髙橋 一郎",
      "山﨑直子",
      "渡邉美咲",
      "渡邊健",
      "齋藤太郎",
      "齊藤花子",
      "濱田次郎",
      "濵田三郎",
      "𠮷田健",
      ]),
    );
  });

  it("区切りのある姓名を姓辞書と名の形式で検出する", () => {
    const sourceText = [
      "1. 鈴木花子",
      "2. 髙橋健一",
      "3. 渡邉美咲",
      "4. 齋藤直樹",
      "5. 濵田由美",
      "6. 𠮷田誠",
      "7. 久保田一郎",
      "8. 大久保花子",
      "9. 五十嵐健一",
    ].join("\n");

    const candidates = runRegexDetection(sourceText)
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(candidates).toEqual([
      "鈴木花子",
      "髙橋健一",
      "渡邉美咲",
      "齋藤直樹",
      "濵田由美",
      "𠮷田誠",
      "久保田一郎",
      "大久保花子",
      "五十嵐健一",
    ]);
  });

  it("曖昧姓でも番号付き名簿の姓名全体は検出する", () => {
    const sourceText = [
      "1. 森太郎",
      "2. 原一郎",
      "3. 関美咲",
      "4. 東花子",
    ].join("\n");

    expect(
      runRegexDetection(sourceText)
        .filter((candidate) => candidate.category === "PERSON")
        .map((candidate) => candidate.originalText),
    ).toEqual(["森太郎", "原一郎", "関美咲", "東花子"]);
  });

  it("曖昧姓でも区切られた連続姓名は検出する", () => {
    const candidates = runRegexDetection("森太郎、原一郎、関美咲、東花子")
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(candidates).toEqual(["森太郎", "原一郎", "関美咲", "東花子"]);
  });

  it("姓・名字・苗字ラベルの単独姓を検出する", () => {
    const candidates = runRegexDetection(
      "姓：鈴木\n名字：高橋\n苗字：田中",
    )
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(candidates).toEqual(["鈴木", "高橋", "田中"]);
  });

  it("敬称に見える仕様語を人名として検出しない", () => {
    const personTexts = runRegexDetection("仕様、既存仕様、検出仕様。")
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(personTexts).not.toEqual(
      expect.arrayContaining(["仕様", "既存仕様", "検出仕様"]),
    );
  });

  it("番号付き名簿の一文字姓を検出する", () => {
    const sourceText = [
      "1. 森",
      "2. 原",
      "3. 関",
      "4. 東",
      "5. 南",
      "6. 岡",
      "7. 堀",
      "8. 辻",
    ].join("\n");

    expect(
      runRegexDetection(sourceText)
        .filter((candidate) => candidate.category === "PERSON")
        .map((candidate) => candidate.originalText),
    ).toEqual(["森", "原", "関", "東", "南", "岡", "堀", "辻"]);
  });

  it("曖昧姓は敬称または明示的な人名ラベルがある場合だけ検出する", () => {
    const sourceText = [
      "森様、原さん、関先生。",
      "担当者：森。",
      "氏名：森 太郎。",
      "患者氏名　原 一郎。",
      "申請者　関 美咲。",
      "森林を保護する。原材料を確認する。関係部署に連絡する。",
      "南側の入口を使用する。東海地方で開催する。森の中を散策する。",
    ].join(" ");
    const personTexts = runRegexDetection(sourceText)
      .filter((candidate) => candidate.category === "PERSON")
      .map((candidate) => candidate.originalText);

    expect(personTexts).toHaveLength(7);
    expect(personTexts).toEqual(
      expect.arrayContaining([
        "森様",
        "原さん",
        "関先生",
        "森",
        "森 太郎",
        "原 一郎",
        "関 美咲",
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

  it("完成した姓名と次行の別姓を1つの候補に結合しない", () => {
    const sourceText = "氏名：佐藤 太郎\n佐藤";
    const personCandidates = runRegexDetection(sourceText).filter(
      (candidate) => candidate.category === "PERSON",
    );

    expect(personCandidates.map((candidate) => candidate.originalText)).toEqual([
      "佐藤 太郎",
    ]);
    expect(
      personCandidates.some((candidate) => candidate.originalText.includes("\n")),
    ).toBe(false);
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
