import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  NerDetectionCancelledError,
  runNerDetection,
} from "./domain/detection/ner/runNerDetection";
import type { DetectionCandidate } from "./domain/detection/mergeCandidates";
import { normalizeDocumentText } from "./domain/normalization/document/normalizeDocumentText";

const normalizationClientMock = vi.hoisted(() => ({
  createNormalizationClient: vi.fn(),
}));

vi.mock("./domain/detection/ner/runNerDetection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./domain/detection/ner/runNerDetection")
  >();

  return {
    ...actual,
    runNerDetection: vi.fn(),
  };
});

vi.mock("./domain/normalization/document/normalizationClient", () => normalizationClientMock);

const runNerDetectionMock = vi.mocked(runNerDetection);
const scrollIntoViewMock = vi.fn();

describe("App", () => {
  beforeEach(() => {
    runNerDetectionMock.mockReset();
    runNerDetectionMock.mockResolvedValue([]);
    normalizationClientMock.createNormalizationClient.mockReturnValue({
      request: async (text: string, mode: "standard" | "detection_priority", sourceRevision: number) => ({
        type: "success",
        requestId: 1,
        sourceRevision,
        mode,
        result: normalizeDocumentText(text, mode),
      }),
      terminate: vi.fn(),
    });
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

  it("表示中の操作ボタンにホバー説明を持つ", () => {
    render(<App />);

    const buttons = Array.from(document.querySelectorAll("button"));
    expect(buttons.filter((button) => !button.title.trim())).toHaveLength(0);
  });

  it("マスク対象の見出し・フィルター・検索を1行にまとめ、検索欄を必要時だけ表示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const panelTitle = screen.getByText("マスク対象", { selector: "strong" });
    const panelHeader = panelTitle.parentElement as HTMLElement;

    expect(within(panelHeader).getByRole("button", { name: "有効（0）" })).toBeInTheDocument();
    expect(within(panelHeader).getByRole("button", { name: "無効（0）" })).toBeInTheDocument();
    expect(
      within(panelHeader).getByRole("button", { name: "マスク対象を検索" }),
    ).toBeInTheDocument();
    const emptyGuidance = screen.getByText(
      "原文でマスク対象が検出、選択されると表示されます。",
    );
    const entryList = emptyGuidance.parentElement as HTMLElement;
    expect(emptyGuidance).toHaveClass("empty-state");
    expect(entryList).toHaveClass("is-empty");
    expect(screen.queryByRole("searchbox", { name: "候補を検索" })).not.toBeInTheDocument();

    await user.click(within(panelHeader).getByRole("button", { name: "マスク対象を検索" }));

    const searchInput = screen.getByRole("searchbox", { name: "候補を検索" });
    expect(entryList).toHaveClass("has-search");
    expect(entryList).toContainElement(searchInput);
    await waitFor(() => expect(searchInput).toHaveFocus());
    await user.type(searchInput, "山田");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("searchbox", { name: "候補を検索" })).not.toBeInTheDocument();
    expect(entryList).not.toHaveClass("has-search");
    await waitFor(() =>
      expect(within(panelHeader).getByRole("button", { name: "マスク対象を検索" })).toHaveFocus(),
    );

    await user.click(within(panelHeader).getByRole("button", { name: "マスク対象を検索" }));
    expect(entryList).toHaveClass("has-search");
    expect(screen.getByRole("searchbox", { name: "候補を検索" })).toHaveValue("");
  });

  it("一覧のスクロールバー幅をヘッダー右端揃え用のCSS変数へ反映する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const panel = screen.getByRole("complementary", { name: "マスク対象管理" });
    const entryList = panel.querySelector(".entry-list") as HTMLElement;
    Object.defineProperty(entryList, "offsetWidth", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(entryList, "clientWidth", {
      configurable: true,
      value: 345,
    });

    await user.click(within(panel).getByRole("button", { name: "マスク対象を検索" }));

    await waitFor(() =>
      expect(panel).toHaveStyle("--entry-list-scrollbar-width: 15px"),
    );
  });

  it("出現箇所マスク方式の切替UIを表示しない", () => {
    render(<App />);

    expect(screen.queryByRole("combobox", { name: "出現箇所マスク方式" })).not.toBeInTheDocument();
    expect(screen.queryByText("一括（従来）")).not.toBeInTheDocument();
    expect(screen.queryByText("文脈付き（曖昧姓のみ）")).not.toBeInTheDocument();
  });

  it("ヘッダーメニューはEscで閉じて起点へフォーカスを戻す", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田です");
    const menuButton = screen.getByRole("button", { name: "メニュー" });
    await user.click(menuButton);

    const normalizeItem = screen.getByRole("menuitem", { name: "テキストを正規化" });
    const normalizationTooltip = document.getElementById(
      "normalization-menu-tooltip",
    ) as HTMLElement;
    expect(normalizeItem).toHaveFocus();
    expect(normalizeItem).toHaveAttribute("aria-disabled", "false");
    expect(normalizeItem).toHaveAttribute("aria-describedby", normalizationTooltip.id);
    expect(normalizationTooltip).toHaveAttribute("role", "tooltip");
    expect(normalizationTooltip).toHaveTextContent("空白・改行・表記を整えます。");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();
  });

  it("メニューから正規化を開き、適用結果を新しい原文にする", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "氏名：\n山田 太郎");
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "テキストを正規化" }));

    const dialog = await screen.findByRole("dialog", { name: "テキスト正規化" });
    expect(dialog.querySelectorAll(".modal-footer .button.large")).toHaveLength(0);
    expect(within(dialog).getByRole("radio", { name: /^標準/ })).toBeChecked();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "適用" })).toBeEnabled(),
    );
    const applyButton = within(dialog).getByRole("button", { name: "適用" });
    expect(applyButton).toHaveTextContent("適用");
    expect(applyButton).toHaveAttribute("title", "正規化後の内容を原文に適用します。");
    expect(within(dialog).getByLabelText("正規化前")).toHaveTextContent("氏名：");
    expect(within(dialog).getByLabelText("正規化後")).toHaveTextContent("氏名:");

    await user.click(applyButton);

    expect(screen.queryByRole("dialog", { name: "テキスト正規化" })).not.toBeInTheDocument();
    expect(getEditorText(screen.getByLabelText("原文"))).toBe("氏名:山田 太郎");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "自動検出" })).toHaveFocus(),
    );
  });

  it("変更箇所の内訳をクリックで開閉し、Escapeで起点へ戻す", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "氏名：\n山田 太郎");
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "テキストを正規化" }));

    const dialog = await screen.findByRole("dialog", { name: "テキスト正規化" });
    const summaryButton = await within(dialog).findByRole("button", { name: "内訳を表示" });
    expect(summaryButton).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByRole("region", { name: "内訳（ルール別・延べ件数）" })).not.toBeInTheDocument();

    await user.click(summaryButton);
    expect(summaryButton).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("region", { name: "内訳（ルール別・延べ件数）" })).toHaveTextContent("ラベルと値の結合");

    await user.click(within(dialog).getByLabelText("正規化前"));
    expect(within(dialog).queryByRole("region", { name: "内訳（ルール別・延べ件数）" })).not.toBeInTheDocument();

    await user.click(summaryButton);
    await user.keyboard("{Escape}");
    expect(summaryButton).toHaveAttribute("aria-expanded", "false");
    expect(summaryButton).toHaveFocus();
  });

  it("正規化のキャンセルでは原文を変更しない", async () => {
    const user = userEvent.setup();
    render(<App />);
    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "氏名：\n山田 太郎");

    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "テキストを正規化" }));
    const dialog = await screen.findByRole("dialog", { name: "テキスト正規化" });
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));

    expect(getEditorText(editor)).toBe("氏名：\n山田 太郎");
  });

  it("候補0件の検出完了後は正規化をロックする", async () => {
    const user = userEvent.setup();
    render(<App />);
    setEditorText(screen.getByLabelText("原文"), "候補なしの文章です。");
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await waitFor(() =>
      expect(screen.getByText("自動検出では候補が見つかりませんでした。")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "メニュー" }));
    const normalizeItem = screen.getByRole("menuitem", { name: "テキストを正規化" });
    const normalizationTooltip = document.getElementById(
      "normalization-menu-tooltip",
    ) as HTMLElement;
    expect(normalizeItem).toHaveAttribute("aria-disabled", "true");
    expect(normalizeItem).toHaveAttribute("aria-describedby", normalizationTooltip.id);
    expect(normalizationTooltip).toHaveAttribute("role", "tooltip");
    expect(normalizationTooltip).toHaveTextContent(
      "検出後は正規化できません。全消去してやり直してください。",
    );
    expect(document.querySelector(".header-menu-disabled-reason")).not.toBeInTheDocument();
    await user.click(normalizeItem);
    expect(screen.queryByRole("dialog", { name: "テキスト正規化" })).not.toBeInTheDocument();
  });

  it("原文入力、手動追加、マスク結果タブ切替を通しで操作できる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "こんにちは、山田太郎です。山田太郎です。");
    selectEditorRange(editor, 6, 10);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));

    const dialog = screen.getByRole("dialog", { name: "マスク対象に追加" });
    expect(dialog.querySelectorAll(".modal-footer .button.large")).toHaveLength(0);
    expect(within(dialog).getByLabelText("対象の文字列")).toHaveValue(
      "山田太郎",
    );
    expect(within(dialog).getByText(/2か所すべて/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "追加してマスク" }));

    expect(
      screen.getByLabelText("原文").querySelectorAll(".original-highlight.is-approved"),
    ).toHaveLength(2);
    expect(document.querySelector(".original-highlight-layer")).not.toBeInTheDocument();

    const originalHighlight = screen
      .getByLabelText("原文")
      .querySelector<HTMLElement>(".original-highlight");
    expect(originalHighlight).not.toBeNull();
    scrollIntoViewMock.mockClear();
    await user.click(originalHighlight as HTMLElement);
    expect(
      screen.getByRole("button", { name: "山田太郎の最初の出現箇所へ移動" }).closest("article"),
    ).toHaveClass("is-selected");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });

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

  it("人名カードを同一人物として関連付け、マスクトークンを統一する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田さんと山田太郎さん");

    selectEditorRange(editor, 0, 2);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );

    selectEditorRange(editor, 5, 9);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );

    await user.click(
      screen.getByRole("checkbox", { name: "山田を同一人物として選択" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "山田太郎を同一人物として選択" }),
    );
    expect(screen.queryByText("2件選択中")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "選択解除" }),
    ).not.toBeInTheDocument();
    const selectedCard = screen.getByRole("article", {
      name: "山田太郎、有効",
    });
    expect(
      within(selectedCard).getByRole("tooltip", {
        name: "同一人物として関連付ける対象に選択",
      }),
    ).toBeInTheDocument();
    expect(
      selectedCard.querySelector(".entry-text-row")?.firstElementChild,
    ).toHaveClass("entry-relation-select");
    await user.click(
      within(selectedCard).getByRole("button", {
        name: "山田太郎の操作メニュー",
      }),
    );
    await user.click(
      within(selectedCard).getByRole("menuitem", {
        name: "同一人物として関連付け",
      }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "同一人物として関連付け",
    });
    expect(
      within(dialog).getByRole("radio", { name: "① 新規の関連付け" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "② 既存の関連付けへの追加" }),
    ).toBeDisabled();
    expect(within(dialog).getByLabelText("復元時の代表表記")).toHaveValue(
      "山田太郎",
    );
    await user.click(within(dialog).getByRole("button", { name: "関連付ける" }));

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getAllByRole("button", { name: "[人名_1]" })).toHaveLength(2);
    expect(screen.getAllByText("関連付け1")).toHaveLength(2);
  });

  it("3件以上の同一人物関連付けでは解除方法を選択できる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田さんと山田太郎さんと田中さん");

    const addEntry = async (start: number, end: number) => {
      selectEditorRange(editor, start, end);
      await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
          "button",
          { name: "追加してマスク" },
        ),
      );
    };

    await addEntry(0, 2);
    await addEntry(5, 9);
    await addEntry(12, 14);

    await user.click(
      screen.getByRole("checkbox", { name: "山田を同一人物として選択" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "山田太郎を同一人物として選択" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "田中を同一人物として選択" }),
    );

    const selectedCard = screen.getByRole("article", {
      name: "山田、有効",
    });
    await user.click(
      within(selectedCard).getByRole("button", {
        name: "山田の操作メニュー",
      }),
    );
    await user.click(
      within(selectedCard).getByRole("menuitem", { name: "同一人物として関連付け" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "同一人物として関連付け" })).getByRole(
        "button",
        { name: "関連付ける" },
      ),
    );

    await user.click(
      within(selectedCard).getByRole("button", {
        name: "山田の操作メニュー",
      }),
    );
    await user.click(
      within(selectedCard).getByRole("menuitem", { name: "関連付けを解除" }),
    );

    const dialog = screen.getByRole("dialog", { name: "関連付けを解除" });
    expect(
      within(dialog).getByRole("radio", { name: "このマスクのみ解除する" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("radio", {
        name: "同一の関連付けをすべて解除する",
      }),
    ).not.toBeChecked();

    await user.click(
      within(dialog).getByRole("radio", {
        name: "同一の関連付けをすべて解除する",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "関連付けを解除する" }),
    );

    expect(screen.queryByRole("dialog", { name: "関連付けを解除" })).not.toBeInTheDocument();
    expect(screen.queryAllByText("関連付け1")).toHaveLength(0);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "山田の操作メニュー" }),
      ).toHaveFocus(),
    );
  });

  it("1件選択時は既存の関連付けへの追加だけを選べる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "山田さんと山田太郎さんと田中さん");

    const addEntry = async (start: number, end: number) => {
      selectEditorRange(editor, start, end);
      await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
          "button",
          { name: "追加してマスク" },
        ),
      );
    };

    await addEntry(0, 2);
    await addEntry(5, 9);
    await addEntry(12, 14);

    await user.click(
      screen.getByRole("checkbox", { name: "山田を同一人物として選択" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "山田太郎を同一人物として選択" }),
    );
    const fullNameCard = screen.getByRole("article", {
      name: "山田太郎、有効",
    });
    await user.click(
      within(fullNameCard).getByRole("button", {
        name: "山田太郎の操作メニュー",
      }),
    );
    await user.click(
      within(fullNameCard).getByRole("menuitem", {
        name: "同一人物として関連付け",
      }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "同一人物として関連付け" })).getByRole(
        "button",
        { name: "関連付ける" },
      ),
    );

    await user.click(
      screen.getByRole("checkbox", { name: "田中を同一人物として選択" }),
    );
    const newPersonCard = screen.getByRole("article", {
      name: "田中、有効",
    });
    await user.click(
      within(newPersonCard).getByRole("button", {
        name: "田中の操作メニュー",
      }),
    );
    await user.click(
      within(newPersonCard).getByRole("menuitem", {
        name: "同一人物として関連付け",
      }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "同一人物として関連付け",
    });
    expect(
      within(dialog).getByRole("radio", { name: "① 新規の関連付け" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("radio", { name: "② 既存の関連付けへの追加" }),
    ).toBeChecked();
    const selectedGroup = within(dialog).getByLabelText("追加先の関連付け");
    expect((selectedGroup as HTMLSelectElement).value).toMatch(/^related-1-/);

    await user.click(within(dialog).getByRole("button", { name: "関連付ける" }));

    expect(screen.getAllByText("関連付け1")).toHaveLength(3);
  });

  it("マスク対象カードのアイコンから本文内の最初の出現箇所へ移動する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    setEditorText(editor, "前半。山田太郎。後半。山田太郎。");
    selectEditorRange(editor, 3, 7);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );

    const locateButton = screen.getByRole("button", {
      name: "山田太郎の最初の出現箇所へ移動",
    });
    expect(locateButton).toHaveAttribute("title", "本文内の最初の出現箇所へ移動");

    scrollIntoViewMock.mockClear();
    await user.click(locateButton);
    expect(screen.getByRole("tab", { name: "原文" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(locateButton.closest("article")).toHaveClass("is-selected");

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));
    scrollIntoViewMock.mockClear();
    await user.click(locateButton);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
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
    const disabledFilter = screen.getByRole("button", { name: "無効（0）" });
    await user.click(disabledFilter);
    scrollIntoViewMock.mockClear();
    await user.click(maskedToken);

    expect(disabledFilter).toHaveClass("is-active");
    expect(within(managementPanel).queryByText("山田")).not.toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "有効（1）" }));
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
    expect(dialog.querySelectorAll(".modal-footer .button.large")).toHaveLength(0);
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
    expect(
      within(managementPanel).getAllByRole("article", { name: /、有効$/ }),
    ).toHaveLength(2);
    expect(screen.queryByText("AI検出中")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll(".original-highlight.is-approved")).map(
        (element) => element.textContent,
      ),
    ).toEqual(["yamada@example.com", "090-1234-5678"]);
    expect(screen.getByText("マスク対象")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有効（2）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効（0）" })).toBeInTheDocument();

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

  it("OCR改行を含むメールを原文表記のまま1つの対象としてマスクする", async () => {
    const user = userEvent.setup();
    render(<App />);
    const email = "taro.yamada@\nexample.co.jp";

    setEditorText(screen.getByLabelText("原文"), `連絡先は${email}です。`);
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    await waitFor(() =>
      expect(managementPanel.querySelector(".entry-text")?.textContent).toBe(email),
    );

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByRole("button", { name: "[メール_1]" })).toBeInTheDocument();
    expect(screen.getByLabelText("マスク結果")).not.toHaveTextContent(
      "taro.yamada",
    );
    expect(screen.getByLabelText("マスク結果")).not.toHaveTextContent(
      "example.co.jp",
    );
  });

  it("OCR途中改行を含む電話番号を郵便番号へ分割せずマスクする", async () => {
    const user = userEvent.setup();
    render(<App />);
    const phones = [
      "090-1234-\n5678",
      "052-\n123-4567",
      "080-9876-\n5432",
      "03-5123-\n8800",
    ];
    const sourceText = phones.join("\n");

    setEditorText(screen.getByLabelText("原文"), sourceText);
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    await waitFor(() => {
      expect(
        Array.from(managementPanel.querySelectorAll(".entry-text")).map(
          (element) => element.textContent,
        ),
      ).toEqual(expect.arrayContaining(phones));
    });
    expect(within(managementPanel).queryByText("123-4567")).not.toBeInTheDocument();
    expect(within(managementPanel).queryByText("080-9876")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));
    const maskedResult = screen.getByLabelText("マスク結果");

    for (const phone of phones) {
      expect(maskedResult).not.toHaveTextContent(phone);
    }
  });

  it("OCR補正ルールを対象ごとの候補カードへ表示する", async () => {
    const user = userEvent.setup();
    render(<App />);
    const email = "taro-\nyamada@\nexample.\nco.jp";
    const address = "愛知県\n豊田市\n若宮町二丁目15番地";

    setEditorText(
      screen.getByLabelText("原文"),
      `連絡先は${email}です。\n登録住所は${address}です。`,
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    await waitFor(() =>
      expect(
        Array.from(managementPanel.querySelectorAll(".entry-text")).map(
          (element) => element.textContent,
        ),
      ).toEqual(expect.arrayContaining([email, address])),
    );
    const cards = Array.from(managementPanel.querySelectorAll(".entry-card"));
    const emailCard = cards.find(
      (card) => card.querySelector(".entry-text")?.textContent === email,
    ) as HTMLElement;
    const addressCard = cards.find(
      (card) => card.querySelector(".entry-text")?.textContent === address,
    ) as HTMLElement;

    expect(within(emailCard).getByText("改行結合")).toBeInTheDocument();
    expect(within(emailCard).getByText("行末ハイフン継続")).toBeInTheDocument();
    expect(within(addressCard).getByText("改行結合")).toBeInTheDocument();
  });

  it("OCR補正候補のトークンを検出時の補正後文字列へ復元する", async () => {
    const user = userEvent.setup();
    render(<App />);
    const email = "ｔａｒｏ．ｙａｍａｄａ ＠ ｅｘａｍｐｌｅ．ｃｏ．ｊｐ";

    setEditorText(screen.getByLabelText("原文"), `連絡先は${email}です。`);
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await within(screen.getByLabelText("マスク対象管理")).findByText(email);
    await user.click(screen.getByRole("button", { name: "マスクを復元" }));

    const restoreInput = screen.getByRole("textbox", {
      name: "マスクを含む文章",
    });
    await user.click(restoreInput);
    await user.paste("送信先は[メール_1]です。");

    expect(
      screen.getByRole("textbox", { name: "マスクを復元した文章" }),
    ).toHaveValue("送信先はtaro.yamada@example.co.jpです。");
  });

  it("無効化した自動検出対象は再検出しても無効状態を維持する", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "連絡先は yamada@example.com です。");
    await user.click(screen.getByRole("button", { name: "自動検出" }));
    await within(screen.getByLabelText("マスク対象管理")).findByText(
      "yamada@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "yamada@example.comの操作メニュー" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "無効化" }));

    expect(screen.getByRole("button", { name: "無効（1）" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再検出" }));
    await screen.findByText("自動検出完了：追加0件、更新1件。");

    await user.click(screen.getByRole("button", { name: "無効（1）" }));
    expect(screen.getByRole("article", { name: /、無効$/ })).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "yamada@example.comの操作メニュー" }),
    );
    expect(screen.getByRole("menuitem", { name: "有効化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効（1）" })).toBeInTheDocument();

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
        normalizationRules: ["japanese_inter_character_space"],
      },
    ]);
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田太郎さんに連絡する。");
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(
      await within(managementPanel).findByText("山田太郎さん"),
    ).toBeInTheDocument();
    expect(within(managementPanel).getByText("AI検出")).toBeInTheDocument();
    expect(within(managementPanel).getByText("空白補正")).toBeInTheDocument();
    expect(within(managementPanel).queryByText("氏名空白補正")).not.toBeInTheDocument();
    const targetText = within(managementPanel).getByText("山田太郎さん");
    const confidenceTooltip = within(managementPanel).getByRole("tooltip", {
      name: "AI検出の信頼度：91%",
    });
    expect(targetText).toHaveAttribute("tabindex", "0");
    expect(targetText).toHaveAttribute("aria-describedby", confidenceTooltip.id);
    expect(
      within(managementPanel).queryByText("信頼度 91%"),
    ).not.toBeInTheDocument();
    expect(
      within(managementPanel).getByRole("article", { name: /、有効$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有効（1）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効（0）" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByRole("button", { name: "[人名_1]" })).toBeInTheDocument();
    expect(screen.getByLabelText("マスク結果")).toHaveTextContent(
      "[人名_1]に連絡する。",
    );
  });

  it("姓リスト外の敬称付き氏名を文脈に関わらず抽出する", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(
      screen.getByLabelText("原文"),
      "担当者は田中さん、鬼頭さん、鬼頭君で伊藤さんが責任者です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    for (const name of ["田中さん", "鬼頭さん", "鬼頭君", "伊藤さん"]) {
      expect(await within(managementPanel).findByText(name)).toBeInTheDocument();
    }

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));
    const maskedResult = screen.getByLabelText("マスク結果");
    expect(maskedResult).not.toHaveTextContent("鬼頭さん");
    expect(maskedResult).not.toHaveTextContent("鬼頭君");
  });

  it("読み仮名付き氏名を補完し、読み仮名内のNER断片を表示しない", async () => {
    const user = userEvent.setup();
    const sourceText = [
      "山田太郎やまだたろう",
      "鈴木一郎すずきいちろう",
    ].join("\n");
    const madaStart = sourceText.indexOf("まだ");
    const rouStart = sourceText.indexOf("ろう");
    runNerDetectionMock.mockResolvedValue([
      {
        originalText: "まだ",
        category: "ORGANIZATION",
        source: "ner",
        start: madaStart,
        end: madaStart + 2,
        confidence: 0.95,
      },
      {
        originalText: "ろう",
        category: "ORGANIZATION",
        source: "ner",
        start: rouStart,
        end: rouStart + 2,
        confidence: 0.94,
      },
    ]);
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), sourceText);
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(
      await within(managementPanel).findByText("山田太郎"),
    ).toBeInTheDocument();
    expect(within(managementPanel).getByText("鈴木一郎")).toBeInTheDocument();
    expect(within(managementPanel).queryByText("まだ")).not.toBeInTheDocument();
    expect(within(managementPanel).queryByText("ろう")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有効（2）" })).toBeInTheDocument();
  });

  it("1秒を超える検出だけ進捗を表示し、候補反映後に完了表示へ切り替える", async () => {
    const user = userEvent.setup();
    let resolveDetection: (candidates: DetectionCandidate[]) => void = () => {};
    runNerDetectionMock.mockImplementation(
      () =>
        new Promise<DetectionCandidate[]>((resolve) => {
          resolveDetection = resolve;
        }),
    );
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "氏名：山田太郎");
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    expect(screen.queryByText("AI検出中")).not.toBeInTheDocument();
    expect(
      await screen.findByText("AI検出中", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中止" })).toBeInTheDocument();

    await act(async () => {
      resolveDetection([
        {
          originalText: "山田太郎",
          category: "PERSON",
          source: "ner",
          confidence: 0.91,
        },
      ]);
    });

    expect(
      await within(screen.getByLabelText("マスク対象管理")).findByText(
        "山田太郎",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("AI検出中")).not.toBeInTheDocument();
    expect(screen.getByText(/自動検出完了/)).toBeInTheDocument();
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
    expect(within(managementPanel).getByText("[住所_1]")).toBeInTheDocument();
    expect(within(managementPanel).getByText("[その他_1]")).toBeInTheDocument();
    expect(within(managementPanel).queryByText("住所")).not.toBeInTheDocument();
    expect(within(managementPanel).queryByText("その他")).not.toBeInTheDocument();
    expect(within(managementPanel).getAllByText("形式")).toHaveLength(2);
    expect(
      within(managementPanel).getAllByRole("article", { name: /、有効$/ }),
    ).toHaveLength(2);
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
    expect(
      screen.getByText(
        "AI検出に失敗しました。形式検出のみ完了：追加1件、更新0件。",
      ),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(
        "AI検出を中止しました。形式検出のみ完了：追加1件、更新0件。",
      ),
    ).toBeInTheDocument();
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
    await screen.findByText(/AI検出に失敗しました/);
    await user.click(screen.getByRole("button", { name: "再検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    expect(await within(managementPanel).findByText("山田太郎")).toBeInTheDocument();
    expect(within(managementPanel).getByText("AI検出")).toBeInTheDocument();
    expect(runNerDetectionMock).toHaveBeenCalledTimes(2);
  });

  it("AI検出に失敗しても改行された組織名を形式候補として表示する", async () => {
    const user = userEvent.setup();
    const organization = "合同会社みらいテクノロ\nジー";
    runNerDetectionMock.mockRejectedValueOnce(new Error("model failed"));
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), `所属：${organization}です。`);
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    const managementPanel = screen.getByLabelText("マスク対象管理");
    await waitFor(() => {
      expect(
        Array.from(managementPanel.querySelectorAll(".entry-text")).some(
          (element) => element.textContent === organization,
        ),
      ).toBe(true);
    });
    const card = Array.from(managementPanel.querySelectorAll(".entry-card")).find(
      (element) => element.querySelector(".entry-text")?.textContent === organization,
    ) as HTMLElement;

    expect(within(card).getByText("[組織_1]")).toBeInTheDocument();
    expect(within(card).queryByText("組織")).not.toBeInTheDocument();
    expect(within(card).getByText("形式")).toBeInTheDocument();
    expect(within(card).getByText("改行結合")).toBeInTheDocument();
    expect(await screen.findByText(/AI検出に失敗しました/)).toBeInTheDocument();
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
    expect(
      await screen.findByText("AI検出中", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "すべて消去" }));

    await waitFor(() => expect(receivedSignal?.aborted).toBe(true));
    expect(receivedSignal?.reason).toBe("session-cleared");
    expect(getEditorText(screen.getByLabelText("原文"))).toBe("");
    expect(screen.getByRole("button", { name: "有効（0）" })).toBeInTheDocument();
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

    const activeCard = screen.getByRole("article", { name: "山田、有効" });
    const menuButton = within(activeCard).getByRole("button", {
      name: "山田の操作メニュー",
    });
    const entryText = within(activeCard).getByText("山田");
    expect(entryText.nextElementSibling).toHaveAttribute(
      "aria-label",
      "山田の最初の出現箇所へ移動",
    );

    await user.click(menuButton);
    expect(screen.getByRole("menu", { name: "山田の操作" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "山田の操作" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();

    await user.click(menuButton);
    await user.click(screen.getByRole("menuitem", { name: "無効化" }));

    await user.click(screen.getByRole("button", { name: "無効（1）" }));
    expect(screen.getByRole("article", { name: /、無効$/ })).toBeInTheDocument();
    const disabledMenuButton = screen.getByRole("button", {
      name: "山田の操作メニュー",
    });
    await user.click(disabledMenuButton);
    expect(screen.getByRole("menuitem", { name: "有効化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効（1）" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "除外" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "有効化" }));

    expect(screen.getByText("無効なマスク対象はありません。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効（0）" })).toBeInTheDocument();
  });

  it("原文に未出現になった有効項目は有効フィルターに残る", async () => {
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
    await user.click(screen.getByRole("button", { name: "有効（1）" }));

    expect(screen.queryByRole("button", { name: "0件" })).not.toBeInTheDocument();
    expect(screen.getByText("山田")).toBeInTheDocument();
    expect(screen.getByLabelText("現在の原文に存在しない: 0か所")).toHaveTextContent(
      "0か所",
    );
    expect(
      screen.getByRole("button", { name: "山田の最初の出現箇所へ移動" }),
    ).toBeDisabled();
  });

  it("復元エリアはマスクを含む文章と復元後の文章として表示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "マスクを復元" }));

    expect(
      screen.getByRole("textbox", { name: "マスクを含む文章" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "マスクを復元した文章" }),
    ).toBeInTheDocument();
    const expandButton = screen.getByRole("button", { name: "入力欄を拡大" });
    expect(expandButton).toBeInTheDocument();
    expect(expandButton.parentElement).toHaveClass("restore-field-heading");
    expect(expandButton.closest(".restore-textarea-wrap")).not.toBeInTheDocument();
    const restoreOutput = screen.getByRole("textbox", {
      name: "マスクを復元した文章",
    });
    expect(restoreOutput.closest(".restore-field")?.firstElementChild).toHaveClass(
      "restore-field-heading",
    );
    expect(screen.getAllByRole("button", { name: "入力欄を拡大" })).toHaveLength(1);
    const restoreInput = screen.getByRole("textbox", { name: "マスクを含む文章" });

    await user.click(screen.getByRole("button", { name: "入力欄を拡大" }));
    expect(screen.getByRole("button", { name: "入力欄を縮小" })).toBeInTheDocument();
    expect(document.querySelector(".restore-content")).toHaveClass("is-expanded");
    expect(document.querySelector(".restore-dock")).toHaveClass("is-maximized");
    expect(document.querySelector(".app-shell")).toHaveClass("is-restore-maximized");
    expect((restoreInput as HTMLTextAreaElement).style.height).toMatch(/px$/);

    await user.click(screen.getByRole("button", { name: "入力欄を縮小" }));
    expect(screen.getByRole("button", { name: "入力欄を拡大" })).toBeInTheDocument();
    expect(document.querySelector(".restore-content")).not.toHaveClass("is-expanded");
    expect(document.querySelector(".restore-dock")).not.toHaveClass("is-maximized");
    expect(document.querySelector(".app-shell")).not.toHaveClass("is-restore-maximized");
    expect(restoreInput).toHaveStyle({ height: "160px" });

    expect(
      screen.queryByRole("button", { name: "外部AI回答のトークンを復元" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("外部回答")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("復元結果")).not.toBeInTheDocument();
  });

  it("拡大直後の古いResizeObserver通知でテキストエリアを縮小しない", async () => {
    const user = userEvent.setup();
    const resizeCallbacks: ResizeObserverCallback[] = [];
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }

        disconnect() {}
        observe() {}
        unobserve() {}
      },
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "マスクを復元" }));

    const restoreInput = screen.getByRole("textbox", {
      name: "マスクを含む文章",
    });
    const restoreOutput = screen.getByRole("textbox", {
      name: "マスクを復元した文章",
    });
    const rect = (top: number, height: number) =>
      ({
        bottom: top + height,
        height,
        left: 0,
        right: 100,
        top,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    vi.spyOn(document.querySelector(".app-shell")!, "getBoundingClientRect").mockReturnValue(
      rect(0, 800),
    );
    vi.spyOn(document.querySelector(".app-header")!, "getBoundingClientRect").mockReturnValue(
      rect(0, 52),
    );
    vi.spyOn(document.querySelector(".restore-dock")!, "getBoundingClientRect").mockReturnValue(
      rect(52, 250),
    );
    vi.spyOn(
      document.querySelector(".restore-content")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(52, 450));
    vi.spyOn(restoreInput, "getBoundingClientRect").mockReturnValue(rect(90, 160));
    vi.spyOn(restoreOutput, "getBoundingClientRect").mockReturnValue(rect(90, 160));

    await user.click(screen.getByRole("button", { name: "入力欄を拡大" }));
    expect(restoreInput).toHaveStyle({ height: "309px" });

    const latestCallback = resizeCallbacks.at(-1);
    expect(latestCallback).toBeDefined();
    act(() => {
      latestCallback?.(
        [{ target: restoreInput } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(restoreInput).toHaveStyle({ height: "309px" });
    expect(restoreOutput).toHaveStyle({ height: "309px" });
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("対応ブラウザではView Transition内で復元欄を開閉する", async () => {
    const user = userEvent.setup();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {};
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(<App />);
    const toggle = screen.getByRole("button", { name: "マスクを復元" });

    await user.click(toggle);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.change(screen.getByRole("textbox", { name: "マスクを含む文章" }), {
      target: { value: "[PERSON_1]です。" },
    });
    await user.click(toggle);
    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByRole("textbox", { name: "マスクを含む文章" })).toHaveValue(
      "[PERSON_1]です。",
    );

    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("対応ブラウザではView Transition内で復元入力欄を拡大縮小する", async () => {
    const user = userEvent.setup();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {};
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "マスクを復元" }));
    await user.click(screen.getByRole("button", { name: "入力欄を拡大" }));

    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "入力欄を縮小" })).toHaveFocus();
    expect(document.querySelector(".restore-dock")).toHaveClass("is-maximized");

    await user.click(screen.getByRole("button", { name: "入力欄を縮小" }));

    expect(startViewTransition).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "入力欄を拡大" })).toHaveFocus();
    expect(document.querySelector(".restore-dock")).not.toHaveClass("is-maximized");

    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("動きを減らす設定ではView Transitionを使わず復元欄を開く", async () => {
    const user = userEvent.setup();
    const startViewTransition = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((media: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: media === "(prefers-reduced-motion: reduce)",
        media,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }) as MediaQueryList),
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    render(<App />);
    const toggle = screen.getByRole("button", { name: "マスクを復元" });
    await user.click(toggle);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "入力欄を拡大" }));
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(document.querySelector(".restore-dock")).toHaveClass("is-maximized");

    Reflect.deleteProperty(window, "matchMedia");
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("30,000文字まで入力でき、超過した変更は適用しない", () => {
    render(<App />);
    const editor = screen.getByLabelText("原文");
    const withinLimit = "あ".repeat(30_000);

    setEditorText(editor, withinLimit);

    expect(getEditorText(editor)).toHaveLength(30_000);
    expect(screen.getByText("文字数: 30,000 / 30,000")).toBeInTheDocument();

    setEditorText(editor, `${withinLimit}い`);

    expect(getEditorText(editor)).toBe(withinLimit);
  });

  it("全消去で原文と候補をリセットする", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田です");
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "すべて消去" }));
    await user.click(screen.getByRole("button", { name: "すべて消去" }));

    expect(getEditorText(screen.getByLabelText("原文"))).toBe("");
    expect(screen.getByText("文字数: 0 / 30,000")).toBeInTheDocument();
  });

  it("全消去確認を一般ユーザー向けの文言とコンパクトな操作ボタンで表示する", async () => {
    const user = userEvent.setup();
    render(<App />);

    setEditorText(screen.getByLabelText("原文"), "山田です");
    await user.click(screen.getByRole("button", { name: "メニュー" }));
    await user.click(screen.getByRole("menuitem", { name: "すべて消去" }));

    const dialog = screen.getByRole("dialog", {
      name: "入力内容をすべて消去しますか？",
    });
    expect(dialog).toHaveClass("clear-confirm-modal");
    expect(within(dialog).getByText(
      "入力した文章、マスク対象、復元内容がすべて消去されます。この操作は取り消せません。",
    )).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "キャンセル" })).not.toHaveClass(
      "large",
    );
    const confirmButton = within(dialog).getByRole("button", { name: "すべて消去" });
    expect(confirmButton).not.toHaveClass("large");
    expect(confirmButton).toHaveAttribute("title", "入力内容をすべて消去します");
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
