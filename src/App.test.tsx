import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  it("原文入力、手動追加、マスク結果タブ切替を通しで操作できる", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    await user.type(editor, "こんにちは、山田太郎です。山田太郎です。");
    await user.pointer([
      { target: editor, offset: 6, keys: "[MouseLeft>]" },
      { offset: 10 },
      { keys: "[/MouseLeft]" },
    ]);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));

    const dialog = screen.getByRole("dialog", { name: "マスク対象に追加" });
    expect(within(dialog).getByText(/2か所すべて/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "追加してマスク" }));

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getAllByRole("button", { name: "[人名_1]" })).toHaveLength(2);
    expect(screen.getByText(/コピー前に原文とマスク結果を確認/)).toBeInTheDocument();
  });

  it("有効なマスク対象がないコピーは確認を挟む", async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(<App />);

    await user.type(screen.getByLabelText("原文"), "山田です");
    await user.click(screen.getByRole("tab", { name: "マスク結果" }));
    await user.click(screen.getByRole("button", { name: "コピー" }));

    const dialog = screen.getByRole("dialog", {
      name: "有効なマスク対象がありません",
    });
    await user.click(within(dialog).getByRole("button", { name: "コピーする" }));

    expect(writeTextSpy).toHaveBeenCalledWith("山田です");
  });

  it("形式検出候補は承認されるまでマスク結果へ反映されない", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(
      screen.getByLabelText("原文"),
      "連絡先は yamada@example.com と 090-1234-5678 です。",
    );
    await user.click(screen.getByRole("button", { name: "自動検出" }));

    expect(await screen.findByText("yamada@example.com")).toBeInTheDocument();
    expect(screen.getByText("090-1234-5678")).toBeInTheDocument();
    expect(screen.getAllByText("形式")).toHaveLength(2);
    expect(screen.getAllByText("未確認")).toHaveLength(2);
    expect(screen.getByText("マスク対象")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "未確認 (2)" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByLabelText("マスク結果")).toHaveTextContent(
      "yamada@example.com",
    );
    expect(screen.queryByRole("button", { name: "[メール_1]" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "原文" }));
    await user.click(screen.getAllByRole("button", { name: "マスクする" })[0]);
    await user.click(screen.getByRole("tab", { name: "マスク結果" }));

    expect(screen.getByRole("button", { name: "[メール_1]" })).toBeInTheDocument();
  });

  it("確認済み項目は除外ではなく無効化と削除で操作する", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    await user.type(editor, "山田です。");
    await user.pointer([
      { target: editor, offset: 0, keys: "[MouseLeft>]" },
      { offset: 2 },
      { keys: "[/MouseLeft]" },
    ]);
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
    expect(screen.queryByRole("button", { name: "除外" })).not.toBeInTheDocument();
  });

  it("原文に未出現になった有効項目は有効フィルターに残る", async () => {
    const user = userEvent.setup();
    render(<App />);

    const editor = screen.getByLabelText("原文");
    await user.type(editor, "山田です。");
    await user.pointer([
      { target: editor, offset: 0, keys: "[MouseLeft>]" },
      { offset: 2 },
      { keys: "[/MouseLeft]" },
    ]);
    await user.click(screen.getByRole("button", { name: "選択範囲を追加" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "マスク対象に追加" })).getByRole(
        "button",
        { name: "追加してマスク" },
      ),
    );

    await user.clear(editor);
    await user.type(editor, "佐藤です。");
    await user.click(screen.getByRole("button", { name: /^有効/ }));

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

    await user.type(screen.getByLabelText("原文"), "山田です");
    await user.click(screen.getByRole("button", { name: "Clear All" }));
    await user.click(screen.getByRole("button", { name: "全消去" }));

    expect(screen.getByLabelText("原文")).toHaveValue("");
    expect(screen.getByText("文字数: 0 / 10,000")).toBeInTheDocument();
  });
});
