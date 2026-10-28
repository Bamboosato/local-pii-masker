import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdditionalDetectionPanel } from "./AdditionalDetectionPanel";
import { browserPromptAdapter } from "../domain/detection/prompt/adapter";

const text = "合成はるかさんと森の中";
const props = { text, entries: [], ready: true, mode: "contextual_ambiguous_surnames" as const, onApply: vi.fn(), onInspect: vi.fn() };
describe("追加AI確認UI", () => {
  beforeEach(() => { props.onApply.mockReset(); props.onInspect.mockReset(); });
  afterEach(() => vi.restoreAllMocks());
  async function setup(response = JSON.stringify({ entities: [{ text: "合成はるか", category: "PERSON", evidence: "合成はるかさん" }] })) {
    vi.spyOn(browserPromptAdapter, "availability").mockResolvedValue("available");
    const create = vi.spyOn(browserPromptAdapter, "create").mockResolvedValue({ extract: async () => response, destroy: vi.fn() });
    const view = render(<AdditionalDetectionPanel {...props} />);
    fireEvent.click(screen.getByText("追加AI検出（試験）"));
    await waitFor(() => expect(screen.getByRole("button", { name: "追加AI検出を実行" })).toBeEnabled());
    return { ...view, create };
  }
  it("明示実行までモデルを起動せず、初期未選択から選択した候補だけを適用する", async () => {
    const { create } = await setup();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "追加AI検出を実行" }));
    const checkbox = await screen.findByRole("checkbox", { name: "合成はるか（人名）" });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole("button", { name: "選択した候補を追加" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "原文の次の箇所を確認" }));
    expect(props.onInspect).toHaveBeenCalledWith({ start: 0, end: 5 });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "選択した候補を追加" }));
    expect(props.onApply).toHaveBeenCalledWith([expect.objectContaining({ text: "合成はるか" })]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("既存検出が未完了ならAPIが利用可能でも実行しない", async () => {
    const { rerender, create } = await setup();
    rerender(<AdditionalDetectionPanel {...props} ready={false} />);
    expect(screen.getByRole("button", { name: "追加AI検出を実行" })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
  it("全候補棄却は正常0件ではなく警告を表示する", async () => {
    await setup(JSON.stringify({ entities: [{ text: "存在しない氏名", category: "PERSON", evidence: "存在しない氏名" }] }));
    fireEvent.click(screen.getByRole("button", { name: "追加AI検出を実行" }));
    expect(await screen.findByText("検証警告あり：1件を棄却しました。")).toBeInTheDocument();
    expect(screen.queryByText(/^追加候補は見つかりませんでした/)).not.toBeInTheDocument();
  });
  it("中止後の遅延応答が確認一覧へ戻らない", async () => {
    const { create } = await setup();
    let resolve!: (raw: string) => void;
    create.mockResolvedValue({ extract: () => new Promise((r) => { resolve = r; }), destroy: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "追加AI検出を実行" }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "追加検出を中止" }));
    await act(async () => resolve(JSON.stringify({ entities: [] })));
    expect(screen.getByText(/追加検出は完了していません。中止しました/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("原文変更による再マウントで旧処理を破棄する", async () => {
    const { create, rerender } = await setup();
    let signal: AbortSignal | undefined;
    create.mockImplementation(async (s) => { signal = s; return { extract: () => new Promise(() => undefined), destroy: vi.fn() }; });
    fireEvent.click(screen.getByRole("button", { name: "追加AI検出を実行" }));
    await waitFor(() => expect(signal).toBeDefined());
    rerender(<AdditionalDetectionPanel key="new-revision" {...props} text="新しい原文" ready={false} />);
    expect(signal?.aborted).toBe(true);
  });
  it("ページ離脱で未適用の確認一覧を破棄する", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "追加AI検出を実行" }));
    await screen.findByRole("checkbox");
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("画面を離れたため、追加検出結果を破棄しました。")).toBeInTheDocument();
  });
  it("モデル取得は専用の明示操作で行う", async () => {
    vi.spyOn(browserPromptAdapter, "availability").mockResolvedValue("downloadable");
    const destroy = vi.fn();
    const create = vi.spyOn(browserPromptAdapter, "create").mockResolvedValue({ extract: vi.fn(), destroy });
    render(<AdditionalDetectionPanel {...props} ready={false} />);
    fireEvent.click(screen.getByText("追加AI検出（試験）"));
    const button = await screen.findByRole("button", { name: "モデルを準備" });
    expect(create).not.toHaveBeenCalled(); fireEvent.click(button);
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  });
});
