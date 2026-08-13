import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaskMappingLibraryDialog, MaskMappingSaveDialog } from "./MaskMappingDialogs";
import type { MappingListItem } from "../domain/mapping/opfsRepository";
import type { MaskMapping } from "../domain/mapping/types";
import type { MaskEntry } from "../domain/types";

const repositoryMock = vi.hoisted(() => ({
  deleteMaskMapping: vi.fn(),
  listMaskMappings: vi.fn(),
  loadMaskMapping: vi.fn(),
  saveMaskMapping: vi.fn(),
}));

vi.mock("../domain/mapping/opfsRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domain/mapping/opfsRepository")>();
  return {
    ...actual,
    ...repositoryMock,
  };
});

const mappingItem: MappingListItem = {
  mappingId: "mapping-ocr-evaluation",
  name: "OCR崩れ評価用テストデータ",
  createdAt: Date.parse("2026-08-13T01:00:00Z"),
  updatedAt: Date.parse("2026-08-13T01:37:00Z"),
  fileName: "mapping-ocr-evaluation.session.enc",
  formatVersion: 1,
  revision: 1,
  status: "available",
};

const loadedMapping: MaskMapping = {
  schemaVersion: 1,
  mappingId: mappingItem.mappingId,
  name: mappingItem.name,
  createdAt: mappingItem.createdAt,
  updatedAt: mappingItem.updatedAt,
  revision: mappingItem.revision,
  occurrenceMaskingMode: "contextual_ambiguous_surnames",
  entries: [
    {
      id: "entry-1",
      targetText: "山田太郎",
      normalizedTargetText: "山田太郎",
      token: "[PERSON_1]",
      restorationText: "山田太郎",
      category: "PERSON",
      sources: ["manual"],
      manual: true,
    },
  ],
};

function renderLibrary(options?: {
  list?: MappingListItem[];
  onDeleteAll?: (count: number) => void;
  onDeleted?: (mappingId: string) => void;
  onLoaded?: (mapping: MaskMapping) => void;
}) {
  repositoryMock.listMaskMappings.mockResolvedValue(options?.list ?? [mappingItem]);
  const onDeleteAll = options?.onDeleteAll ?? vi.fn();
  const onDeleted = options?.onDeleted ?? vi.fn();
  const onLoaded = options?.onLoaded ?? vi.fn();
  render(
    <MaskMappingLibraryDialog
      onClose={vi.fn()}
      onDeleteAll={onDeleteAll}
      onDeleted={onDeleted}
      onError={vi.fn()}
      onLoaded={onLoaded}
      refreshKey={0}
    />,
  );
  return { onDeleteAll, onDeleted, onLoaded };
}

describe("MaskMappingLibraryDialog", () => {
  beforeEach(() => {
    repositoryMock.deleteMaskMapping.mockReset();
    repositoryMock.listMaskMappings.mockReset();
    repositoryMock.loadMaskMapping.mockReset();
  });

  it("一覧からパスフレーズ画面へ進み、入力前は開く操作を無効にする", async () => {
    const user = userEvent.setup();
    const { onLoaded } = renderLibrary();

    const openButton = await screen.findByRole("button", { name: `${mappingItem.name}を開く` });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("パスフレーズ")).not.toBeInTheDocument();

    repositoryMock.loadMaskMapping.mockResolvedValue(loadedMapping);
    await user.click(openButton);

    expect(screen.getByRole("heading", { name: "対応表を開く" })).toBeInTheDocument();
    const passphrase = screen.getByLabelText("パスフレーズ");
    expect(passphrase).toHaveClass("dialog-input");
    expect(passphrase).toHaveAttribute("type", "password");
    expect(passphrase).toHaveFocus();
    expect(screen.getByRole("button", { name: "対応表を開く" })).toBeDisabled();

    await user.type(passphrase, "abcdefghijkl");
    expect(screen.getByRole("button", { name: "対応表を開く" })).not.toBeDisabled();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(loadedMapping));
  });

  it("誤ったパスフレーズでは画面を閉じずエラーだけを表示する", async () => {
    const user = userEvent.setup();
    renderLibrary();
    repositoryMock.loadMaskMapping.mockRejectedValue(new Error("PBKDF2の反復回数が不正です。"));

    await user.click(await screen.findByRole("button", { name: `${mappingItem.name}を開く` }));
    await user.type(screen.getByLabelText("パスフレーズ"), "abcdefghijkl");
    await user.click(screen.getByRole("button", { name: "対応表を開く" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("対応表を開けませんでした。パスフレーズを確認してください。");
    expect(screen.getByRole("heading", { name: "対応表を開く" })).toBeInTheDocument();
    expect(screen.queryByText("PBKDF2の反復回数が不正です。")).not.toBeInTheDocument();
    expect(screen.queryByText("山田太郎")).not.toBeInTheDocument();
  });

  it("個別削除は行のその他メニューから確認し、管理画面を空状態へ更新する", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    repositoryMock.listMaskMappings
      .mockResolvedValueOnce([mappingItem])
      .mockResolvedValueOnce([]);
    repositoryMock.deleteMaskMapping.mockResolvedValue(undefined);
    renderLibrary({ onDeleted });

    await user.click(await screen.findByRole("button", { name: `${mappingItem.name}のその他の操作` }));
    await user.click(screen.getByRole("menuitem", { name: "対応表を削除" }));
    expect(screen.getByRole("heading", { name: "対応表を削除しますか？" })).toBeInTheDocument();
    expect(screen.getByText(`「${mappingItem.name}」を削除します。`)).toBeInTheDocument();
    expect(screen.getByText("この操作は取り消せません。現在の作業には影響しません。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.getByText("保存済みの対応表はありません。")).toBeInTheDocument());
    expect(onDeleted).toHaveBeenCalledWith(mappingItem.mappingId);
    expect(screen.queryByRole("button", { name: `${mappingItem.name}を開く` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存済み対応表をすべて削除" })).not.toBeInTheDocument();
  });

  it("全削除は一覧下部の控えめな操作から件数を通知する", async () => {
    const user = userEvent.setup();
    const { onDeleteAll } = renderLibrary();

    await user.click(await screen.findByRole("button", { name: "保存済み対応表をすべて削除" }));

    expect(onDeleteAll).toHaveBeenCalledWith(1);
    expect(screen.getByRole("heading", { name: "保存済み対応表を管理" })).toBeInTheDocument();
  });

  it("最下行のその他メニューは一覧内へ上向きに開く", async () => {
    const user = userEvent.setup();
    const lastItem = {
      ...mappingItem,
      mappingId: "mapping-last",
      name: "最下行の対応表",
    };
    renderLibrary({ list: [mappingItem, lastItem] });

    await user.click(await screen.findByRole("button", { name: `${lastItem.name}のその他の操作` }));

    expect(screen.getByRole("menu")).toHaveClass("is-open-upward");
  });

  it("空状態では一覧操作を表示しない", async () => {
    renderLibrary({ list: [] });

    expect(await screen.findByText("保存済みの対応表はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /を開く$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存済み対応表をすべて削除" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("パスフレーズ")).not.toBeInTheDocument();
  });
});

describe("MaskMappingSaveDialog", () => {
  const existing = {
    mappingId: "mapping-existing",
    name: "既存の対応表",
    createdAt: Date.parse("2026-08-12T01:00:00Z"),
    revision: 3,
  };
  const entries: MaskEntry[] = [
    {
      id: "entry-1",
      originalText: "山田太郎",
      normalizedText: "山田太郎",
      restorationText: "山田太郎",
      token: "[PERSON_1]",
      category: "PERSON" as const,
      sources: ["manual"],
      enabled: true,
      occurrenceCount: 1,
      reviewStatus: "approved" as const,
      displayOrder: 0,
    },
  ];

  beforeEach(() => {
    repositoryMock.saveMaskMapping.mockReset();
    repositoryMock.saveMaskMapping.mockImplementation(async ({ mapping }: { mapping: MaskMapping }) => mapping);
  });

  function renderSaveDialog() {
    render(
      <MaskMappingSaveDialog
        entries={entries}
        existing={existing}
        onClose={vi.fn()}
        onError={vi.fn()}
        onSaved={vi.fn()}
        occurrenceMaskingMode="contextual_ambiguous_surnames"
      />,
    );
  }

  it("上書き時は同じ対応表を新しいパスフレーズで保存する", async () => {
    const user = userEvent.setup();
    renderSaveDialog();

    expect(screen.getByRole("radio", { name: "既存の対応表を上書き" })).toBeChecked();
    expect(screen.getByLabelText("対応表名")).toHaveClass("dialog-input");
    expect(screen.getByLabelText("対応表名")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("パスフレーズ（12文字以上）")).toHaveClass("dialog-input");
    expect(screen.getByLabelText("パスフレーズ（確認）")).toHaveClass("dialog-input");
    await user.clear(screen.getByLabelText("対応表名"));
    await user.type(screen.getByLabelText("対応表名"), "変更後の対応表");
    await user.type(screen.getByLabelText("パスフレーズ（12文字以上）"), "new-passphrase");
    await user.type(screen.getByLabelText("パスフレーズ（確認）"), "new-passphrase");
    await user.click(screen.getByRole("button", { name: "上書き保存" }));

    await waitFor(() => expect(repositoryMock.saveMaskMapping).toHaveBeenCalled());
    expect(repositoryMock.saveMaskMapping).toHaveBeenCalledWith(expect.objectContaining({
      passphrase: "new-passphrase",
      mapping: expect.objectContaining({
        mappingId: existing.mappingId,
        name: "変更後の対応表",
        revision: existing.revision,
      }),
    }));
  });

  it("新規保存を選ぶと元の対応表を残して新しいIDで保存する", async () => {
    const user = userEvent.setup();
    renderSaveDialog();

    await user.click(screen.getByRole("radio", { name: "新しい対応表として保存" }));
    await user.clear(screen.getByLabelText("対応表名"));
    await user.type(screen.getByLabelText("対応表名"), "別の対応表");
    await user.type(screen.getByLabelText("パスフレーズ（12文字以上）"), "another-passphrase");
    await user.type(screen.getByLabelText("パスフレーズ（確認）"), "another-passphrase");
    await user.click(screen.getByRole("button", { name: "新規に保存" }));

    await waitFor(() => expect(repositoryMock.saveMaskMapping).toHaveBeenCalled());
    const savedMapping = repositoryMock.saveMaskMapping.mock.calls[0][0].mapping as MaskMapping;
    expect(savedMapping.mappingId).not.toBe(existing.mappingId);
    expect(savedMapping.name).toBe("別の対応表");
  });
});
