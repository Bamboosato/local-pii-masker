import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  NerDetectionCancelledError,
  runNerDetection,
} from "./domain/detection/ner/runNerDetection";
import type { DetectionCandidate } from "./domain/detection/mergeCandidates";

vi.mock("./domain/detection/ner/runNerDetection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./domain/detection/ner/runNerDetection")
  >();

  return {
    ...actual,
    runNerDetection: vi.fn(),
  };
});

const runNerDetectionMock = vi.mocked(runNerDetection);
const scrollIntoViewMock = vi.fn();

describe("App", () => {
  beforeEach(() => {
    runNerDetectionMock.mockReset();
    runNerDetectionMock.mockResolvedValue([]);
    scrollIntoViewMock.mockReset();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  it("ヘッダーはデータ取扱表示と必要時だけ有効なメニューに集約する", () => {
    render(<App />);

    expect(screen.getByText("ローカル処理・保存なし")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メニュー" })).toBeDisabled();
    expect(
      screen.queryByRole("menuitem", { name: "すべて消去" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "プライバシー境界" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "再計算" }),
    ).not.toBeInTheDocument();
  });

  it("マスク対象の見出し・フィルター・検索を1行にまとめ、検索欄を必要時だけ表示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const panelTitle = screen.getByText("マスク対象", { selector: "strong" });
    const panelHeader = panelTitle.parentElement as HTMLElement;

    expect(within(panelHeader).getByRole("button", { name: "すべて (0)" })).toBeInTheDocument();
    expect(within(panelHeader).getByRole("button", { name: "無効 (0)" })).toBeInTheDocument();
    expect(
      within(panelHeader).getByRole("button", { name: "マスク対象を検索" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "候補を検索" })).not.toBeInTheDocument();

    await user.click(within(panelHeader).getByRole("button", { name: "マスク対象を検索" }));

    const searchInput = screen.getByRole("searchbox", { name: "候補を検索" });
    await waitFor(() => expect(searchInput).toHaveFocus());
    await user.type(searchInput, "山田");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("searchbox", { name: "候補を検索" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(panelHeader).getByRole("button", { name: "マスク対象を検索" })).toHaveFocus(),
    );

    await user.click(within(panelHeader).getByRole("button", { name: "マスク対象を検索" }));
    expect(screen.getByRole("searchbox", { name: "候補を検索" })).toHaveValue("");
  });

  it("ヘッダーメニューはEscで閉じて起点へフォーカスを戻す", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田です");
    const menuButton = screen.getByRole("button", { name: "メニュー" });
    await user.click(menuButton);

    expect(
      screen.getByRole("menuitem", { name: "すべて消去" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it("原文入力、手動追加、マスク結果タブ切替を通しで操作できる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "こんにちは、山田太郎です。山田太郎です。");
    selectEditorRange(editor, 6, 10);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));

    const dialog = screen.getByRole("dialog", { name: "マスク対象に追加" });
    expect(within(dialog).getByLabelText("対象の文字列")).toHaveValue(
      "山田太郎",
    );
    expect(within(dialog).getByText(/2か所すべて/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "追加してマスク" }));

    expect(
      screen.getByLabelText("原文").querySelectorAll(".original-highlight.is-approved"),
    ).toHaveLength(2);
    expect(document.querySelector(".original-highlight-layer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    const maskedTokens = screen.getAllByRole("button", { name: "[人名_1]" });
    expect(maskedTokens).toHaveLength(2);
    expect(screen.getByText(/コピー前に原文とマスク結果を確認/)).toBeInTheDocument();

    scrollIntoViewMock.mockClear();
    await user.click(maskedTokens[0]);

    expect(screen.getByText("山田太郎").closest("article")).toHaveClass("is-selected");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });
  });

  it("マスク対象がフィルターまたは検索で非表示なら条件を変えずスクロールしない", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田です。");
    selectEditorRange(editor, 0, 2);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );
    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    const maskedToken = screen.getByRole("button", { name: "[人名_1]" });
    const managementPanel = screen.getByLabelText("マスク対象管理");
    const disabledFilter = screen.getByRole("button", { name: "無効 (0)" });
    await user.click(disabledFilter);
    scrollIntoViewMock.mockClear();
    await user.click(maskedToken);

    expect(disabledFilter).toHaveClass("is-active");
    expect(within(managementPanel).queryByText("山田")).not.toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "すべて (1)" }));
    await user.click(screen.getByRole("button", { name: "マスク対象を検索" }));
    const searchInput = screen.getByRole("searchbox", { name: "候補を検索" });
    await user.type(searchInput, "佐藤");
    scrollIntoViewMock.mockClear();
    await user.click(maskedToken);

    expect(searchInput).toHaveValue("佐藤");
    expect(within(managementPanel).queryByText("山田")).not.toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("有効なマスク対象がないコピーは確認を挟む", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田です");
    await user.click(screen.getByRole("tab", { name: "マスク結果" }));
    await user.click(screen.getByRole("button", { name: "コピー" }));

    const dialog = screen.getByRole("dialog", {
      name: "有効なマスク対象がありません",
    });
    await user.click(within(dialog).getByRole("button", { name: "コピーする" }));

    expect(writeTextSpy).toHaveBeenCalledWith("山田です");
  });

  it("形式検出した対象は直後から有効になりマスク結果へ反映される", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "連絡先は yamada@example.com と 090-1234-5678 です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(
      await within(managementPanel).findByText("yamada@example.com"),
    ).toBeInTheDocument();
    expect(within(managementPanel).getByText("090-1234-5678")).toBeInTheDocument();
    expect(within(managementPanel).getAllByText("形式")).toHaveLength(2);
    expect(within(managementPanel).getAllByText("有効")).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll(".original-highlight.is-approved")).map(
        (element) => element.textContent,
      ),
    ).toEqual(["yamada@example.com", "090-1234-5678"]);
    expect(screen.getByText("マスク対象")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "すべて (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効 (0)" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByRole("button", { name: "[メール_1]" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "[電話番号_1]" })).toBeInTheDocument();
  });

  it("@前後に空白があるメールを原文表記のまま有効化してマスクする", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const email = "taro.yamada @ example.co.jp";

    setEditorText(
      screen.getByLabelText("原文"),
      `連絡先は ${email} です。担当者 A @ B と確認した。`,
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(await within(managementPanel).findByText(email)).toBeInTheDocument();
    expect(within(managementPanel).queryByText("A @ B")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll(".original-highlight.is-approved")).map(
        (element) => element.textContent,
      ),
    ).toEqual([email]);

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByRole("button", { name: "[メール_1]" })).toBeInTheDocument();
    expect(screen.getByLabelText("マスク結果")).not.toHaveTextContent(email);
  });

  it("無効化した自動検出対象は再検出しても無効状態を維持する", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "連絡先は yamada@example.com です。");
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await within(screen.getByLabelText("マスク対象管理")).findByText(
      "yamada@example.com",
    );
    await user.click(screen.getByRole("button", { name: "無効化" }));

    expect(screen.getByRole("button", { name: "無効 (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再検出" }));
    await screen.findByText(/既存項目1件へ検出情報を統合しました/);

    expect(screen.getByText("無効")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有効化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効 (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));
    expect(screen.getByLabelText("マスク結果")).toHaveTextContent("yamada@example.com");
    expect(screen.queryByRole("button", { name: "[メール_1]" })).not.toBeInTheDocument();
  });

  it("AI検出した対象も直後から有効になる", async () => {
    const user = userEvent.setup();
    runNerDetectionMock.mockResolvedValue([
      {
        originalText: "山田太郎",
        category: "PERSON",
        source: "ner",
        confidence: 0.91,
      },
    ]);
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田太郎さんに連絡する。");
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(await within(managementPanel).findByText("山田太郎")).toBeInTheDocument();
    expect(within(managementPanel).getByText("AI検出")).toBeInTheDocument();
    expect(within(managementPanel).getByText("信頼度 91%")).toBeInTheDocument();
    expect(within(managementPanel).getByText("有効")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "すべて (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効 (0)" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByRole("button", { name: "[人名_1]" })).toBeInTheDocument();
  });

  it("URLと日本語住所を有効な形式検出対象として表示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "所在地は愛知県豊田市若宮町二丁目15番地です。参照先はhttps://dev.orion.example.jp/loginです。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(
      await within(managementPanel).findByText("愛知県豊田市若宮町二丁目15番地"),
    ).toBeInTheDocument();
    expect(
      within(managementPanel).getByText("https://dev.orion.example.jp/login"),
    ).toBeInTheDocument();
    expect(within(managementPanel).getByText("住所")).toBeInTheDocument();
    expect(within(managementPanel).getByText("その他")).toBeInTheDocument();
    expect(within(managementPanel).getAllByText("形式")).toHaveLength(2);
    expect(within(managementPanel).getAllByText("有効")).toHaveLength(2);
  });

  it("AI検出に失敗しても形式候補は統合される", async () => {
    const user = userEvent.setup();
    runNerDetectionMock.mockRejectedValue(new Error("model failed"));
    render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "連絡先は yamada@example.com です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(
      await within(managementPanel).findByText("yamada@example.com"),
    ).toBeInTheDocument();
    expect(within(managementPanel).getByText("形式")).toBeInTheDocument();
    expect(screen.getByText(/AI検出は実行できなかった/)).toBeInTheDocument();
  });

  it("AI検出を中止しても形式候補を反映し、再検出できる", async () => {
    const user = userEvent.setup();
    runNerDetectionMock.mockImplementation(
      (_text, options) =>
        new Promise<DetectionCandidate[]>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new NerDetectionCancelledError(options.signal?.reason),
              ),
            { once: true },
          );
        }),
    );
    render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "連絡先は yamada@example.com です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await user.click(await screen.findByRole("button", { name: "中止" }));

    expect(
      await within(screen.getByLabelText("マスク対象管理")).findByText(
        "yamada@example.com",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI検出は中止しました/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再検出" })).toBeInTheDocument();
  });

  it("AI検出失敗後の再検出で成功結果を統合する", async () => {
    const user = userEvent.setup();
    runNerDetectionMock
      .mockRejectedValueOnce(new Error("model failed"))
      .mockResolvedValueOnce([
        {
          originalText: "山田太郎",
          category: "PERSON",
          source: "ner",
          confidence: 0.91,
        },
      ]);
    render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "山田太郎の連絡先は yamada@example.com です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await screen.findByText(/AI検出は実行できなかった/);
    await user.click(screen.getByRole("button", { name: "再検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(await within(managementPanel).findByText("山田太郎")).toBeInTheDocument();
    expect(within(managementPanel).getByText("AI検出")).toBeInTheDocument();
    expect(runNerDetectionMock).toHaveBeenCalledTimes(2);
  });

  it("検出中に原文が変更された場合は古い候補を統合しない", async () => {
    const user = userEvent.setup();
    runNerDetectionMock.mockImplementation(
      (_text, options) =>
        new Promise<DetectionCandidate[]>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new NerDetectionCancelledError(options.signal?.reason),
              ),
            { once: true },
          );
        }),
    );
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田太郎さんに連絡する。");
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await screen.findByText(/AI検出モデルを準備しています/);
    setEditorText(editor, "佐藤さんに連絡する。");

    expect(
      await screen.findByText(/原文が変更されたため、自動検出結果は反映しませんでした/),
    ).toBeInTheDocument();
    expect(screen.queryByText("山田太郎")).not.toBeInTheDocument();
    expect(screen.queryByText("AI検出")).not.toBeInTheDocument();
  });

  it("検出中に全消去しても遅延した検出結果や通知を反映しない", async () => {
    const user = userEvent.setup();
    let receivedSignal: AbortSignal | undefined;
    runNerDetectionMock.mockImplementation(
      (_text, options) =>
        new Promise<DetectionCandidate[]>((_resolve, reject) => {
          receivedSignal = options?.signal;
          options?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new NerDetectionCancelledError(options.signal?.reason),
              ),
            { once: true },
          );
        }),
    );
    render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "連絡先は yamada@example.com です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await screen.findByRole("button", { name: "中止" });
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "すべて消去" }));
    await user.click(screen.getByRole("button", { name: "全消去" }));

    await waitFor(() => expect(receivedSignal?.aborted).toBe(true));
    expect(receivedSignal?.reason).toBe("session-cleared");
    expect(getEditorText(screen.getByLabelText("原文"))).toBe("");
    expect(screen.getByRole("button", { name: "すべて (0)" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("確認済み項目は除外ではなく無効化と削除で操作する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田です。");
    selectEditorRange(editor, 0, 2);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );

    expect(screen.queryByRole("button", { name: "除外" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "無効化" }));

    expect(screen.getByText("無効")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有効化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効 (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "除外" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "無効 (1)" }));
    await user.click(screen.getByRole("button", { name: "有効化" }));

    expect(screen.getByText("無効なマスク対象はありません。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効 (0)" })).toBeInTheDocument();
  });

  it("原文に未出現になった有効項目はすべてフィルターに残る", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田です。");
    selectEditorRange(editor, 0, 2);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );

    setEditorText(editor, "佐藤です。");
    await user.click(screen.getByRole("button", { name: /^すべて/ }));

    expect(screen.queryByRole("button", { name: "0件" })).not.toBeInTheDocument();
    expect(screen.getByText("山田")).toBeInTheDocument();
    expect(screen.getByLabelText("現在の原文に存在しない: 0か所")).toHaveTextContent(
      "0か所",
    );
  });

  it("復元エリアはマスクを含む文章と復元後の文章として表示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "マスクを復元" }));

    expect(screen.getByLabelText("マスクを含む文章")).toBeInTheDocument();
    expect(screen.getByLabelText("マスクを復元した文章")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "外部AI回答のトークンを復元" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("外部回答")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("復元結果")).not.toBeInTheDocument();
  });

  it("全消去で原文と候補をリセットする", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田です");
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "すべて消去" }));
    await user.click(screen.getByRole("button", { name: "全消去" }));

    expect(getEditorText(screen.getByLabelText("原文"))).toBe("");
    expect(screen.getByText("文字数: 0 / 10,000")).toBeInTheDocument();
  });
});

function getEditorView(element: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(element);

  if (!view) {
    throw new Error("原文エディターを取得できませんでした。");
  }

  return view;
}

function getEditorText(element: HTMLElement): string {
  return getEditorView(element).state.doc.toString();
}

function setEditorText(element: HTMLElement, value: string) {
  const view = getEditorView(element);

  act(() => {
    view.dispatch({
      changes: { from: 0, insert: value, to: view.state.doc.length },
    });
  });
}

function selectEditorRange(element: HTMLElement, from: number, to: number) {
  const view = getEditorView(element);

  act(() => {
    view.dispatch({ selection: { anchor: from, head: to } });
  });
}
