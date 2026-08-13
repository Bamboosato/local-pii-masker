import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaskMappingLibraryDialog } from "./MaskMappingDialogs";
import type { MappingListItem } from "../domain/mapping/opfsRepository";
import type { MaskMapping } from "../domain/mapping/types";

const repositoryMock = vi.hoisted(() => ({
  deleteMaskMapping: vi.fn(),
  listMaskMappings: vi.fn(),
  loadMaskMapping: vi.fn(),
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
  onLoaded?: (mapping: MaskMapping) => void;
}) {
  repositoryMock.listMaskMappings.mockResolvedValue(options?.list ?? [mappingItem]);
  const onDeleteAll = options?.onDeleteAll ?? vi.fn();
  const onLoaded = options?.onLoaded ?? vi.fn();
  render(
    <MaskMappingLibraryDialog
      onClose={vi.fn()}
      onDeleteAll={onDeleteAll}
      onError={vi.fn()}
      onLoaded={onLoaded}
      refreshKey={0}
    />,
  );
  return { onDeleteAll, onLoaded };
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
    repositoryMock.listMaskMappings
      .mockResolvedValueOnce([mappingItem])
      .mockResolvedValueOnce([]);
    repositoryMock.deleteMaskMapping.mockResolvedValue(undefined);
    renderLibrary();

    await user.click(await screen.findByRole("button", { name: `${mappingItem.name}のその他の操作` }));
    await user.click(screen.getByRole("menuitem", { name: "対応表を削除" }));
    expect(screen.getByRole("heading", { name: `「${mappingItem.name}」を削除しますか？` })).toBeInTheDocument();
    expect(screen.getByText("この操作は取り消せません。現在の作業には影響しません。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "削除" }));

    await waitFor(() => expect(screen.getByText("保存済みの対応表はありません。")).toBeInTheDocument());
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

  it("空状態では一覧操作を表示しない", async () => {
    renderLibrary({ list: [] });

    expect(await screen.findByText("保存済みの対応表はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /を開く$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存済み対応表をすべて削除" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("パスフレーズ")).not.toBeInTheDocument();
  });
});
