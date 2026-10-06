import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = "synthetic-passphrase-123";
const PRIVATE_TEXT = "合成検証太郎";

async function menu(page: Page, label: string) {
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

async function addSyntheticTarget(page: Page) {
  const editor = page.getByRole("textbox", { name: "原文", exact: true });
  await editor.fill(PRIVATE_TEXT);
  await editor.focus();
  await page.keyboard.press("Control+A");
  await page.getByRole("button", { name: "選択範囲を追加", exact: true }).click();
  await page.getByRole("dialog", { name: "マスク対象に追加" }).getByRole("button", { name: "追加してマスク" }).click();
}

test("実OPFSで保存・上書き・再読込・復元・削除を通し、平文と公開キャッシュの境界を保つ", async ({ page }) => {
  const requests: string[] = [];
  const messages: string[] = [];
  page.on("request", (request) => requests.push(request.url() + (request.postData() ?? "")));
  page.on("console", (message) => messages.push(message.text()));
  await page.goto("/");
  await addSyntheticTarget(page);

  for (const label of ["新規に保存", "上書き保存"]) {
    await menu(page, "対応表を保存");
    const save = page.getByRole("dialog", { name: "対応表を保存" });
    await save.getByLabel("対応表名", { exact: true }).fill("合成保存検証");
    await save.getByLabel("パスフレーズ（12文字以上）", { exact: true }).fill(PASSPHRASE);
    await save.getByLabel("パスフレーズ（確認）", { exact: true }).fill(PASSPHRASE);
    await save.getByRole("button", { name: label, exact: true }).click();
    await expect(save).toBeHidden();
  }

  const persisted = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("local-pii-masker");
    const index = JSON.parse(await (await (await root.getFileHandle("index.json")).getFile()).text());
    const backup = JSON.parse(await (await (await root.getFileHandle("index.backup.json")).getFile()).text());
    const directory = await root.getDirectoryHandle("mappings");
    return {
      index, backup,
      current: await (await (await directory.getFileHandle(index[0].fileName)).getFile()).text(),
      previous: await (await (await directory.getFileHandle(backup[0].fileName)).getFile()).text(),
    };
  });
  expect(persisted.index[0].revision).toBe(2);
  expect(persisted.backup[0].revision).toBe(1);
  expect(JSON.stringify(persisted)).not.toContain(PRIVATE_TEXT);
  expect(JSON.stringify(persisted)).not.toContain(PASSPHRASE);
  expect(Object.keys(persisted.index[0]).sort()).toEqual(["createdAt", "fileName", "formatVersion", "mappingId", "name", "revision", "updatedAt"].sort());

  // A reload drops memory and passphrases but preserves only the explicit mapping.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "原文", exact: true })).not.toContainText(PRIVATE_TEXT);
  await expect(page.locator(".entry-card")).toHaveCount(0);
  await page.getByRole("textbox", { name: "原文", exact: true }).fill(PRIVATE_TEXT);
  await page.getByRole("button", { name: "マスクを復元", exact: true }).click();
  await menu(page, "保存済み対応表を管理");
  await page.getByRole("button", { name: "合成保存検証を開く" }).click();
  const open = page.getByRole("dialog", { name: "対応表を開く" });
  await open.getByLabel("パスフレーズ", { exact: true }).fill(PASSPHRASE);
  await open.getByRole("button", { name: "対応表を開く", exact: true }).click();
  await expect(open).toBeHidden();
  await expect(page.getByRole("textbox", { name: "マスクを含む文章" })).toBeHidden();
  await page.getByRole("tab", { name: "マスク結果", exact: true }).click();
  const token = await page.locator(".masked-preview").innerText();
  expect(token).toBeTruthy();
  await page.getByRole("button", { name: "マスクを復元", exact: true }).click();
  await page.getByRole("textbox", { name: "マスクを含む文章" }).fill(token!);
  await expect(page.getByRole("textbox", { name: "マスクを復元した文章" })).toHaveValue(PRIVATE_TEXT);

  await menu(page, "保存済み対応表を管理");
  await page.getByRole("button", { name: "合成保存検証のその他の操作" }).click();
  await page.getByRole("menuitem", { name: "対応表を削除", exact: true }).click();
  await page.getByRole("dialog", { name: "対応表を削除しますか？" }).getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.getByText("保存済みの対応表はありません。", { exact: true })).toBeVisible();
  await expect(page.getByText(/暗号化ファイル0件／未参照0件／一時ファイル0件/)).toBeVisible();
  expect(requests.join("\n") + messages.join("\n")).not.toContain(PRIVATE_TEXT);
  expect(requests.join("\n") + messages.join("\n")).not.toContain(PASSPHRASE);
});
