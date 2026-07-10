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
    expect(screen.getByText(/置換箇所数: 2か所/)).toBeInTheDocument();
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
