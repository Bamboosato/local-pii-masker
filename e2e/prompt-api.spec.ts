import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("追加AI: 明示実行・選択適用・復元・消去と通信境界（APIモック）", async ({ page }, testInfo) => {
  const marker = "synthetic-prompt-private-f92c";
  const requests: string[] = [], logs: string[] = [];
  page.on("request", (r) => requests.push(r.url() + (r.postData() ?? "")));
  page.on("console", (message) => logs.push(message.text()));
  await page.addInitScript(() => {
    window.Worker = class extends EventTarget {
      postMessage(message: { id: number }) { queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "success", id: message.id, candidates: [] } }))); }
      terminate() { /* Synthetic baseline: no model downloads. */ }
    } as unknown as typeof Worker;
    const make = () => ({
      contextWindow: 10000, contextUsage: 100,
      measureContextUsage: async () => 500,
      addEventListener() { /* No overflow in this synthetic response. */ },
      clone: async () => make(), destroy() { /* No external resources. */ },
      promptStreaming: () => new ReadableStream({ start(controller) { controller.enqueue(JSON.stringify({ entities: [{ text: "るりね", category: "PERSON", evidence: "るりねが来た" }] })); controller.close(); } }),
    });
    Object.defineProperty(window, "LanguageModel", { configurable: true, value: { availability: async () => "available", create: async () => make() } });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "原文", exact: true }).fill(`${marker} るりねが来た。るりねと話した。`);
  await page.getByText("追加AI検出（試験）", { exact: true }).click();
  const run = page.getByRole("button", { name: "追加AI検出を実行", exact: true });
  await expect(run).toBeDisabled();
  await page.getByRole("button", { name: "自動検出", exact: true }).click();
  await page.getByText("追加AI検出（試験）", { exact: true }).click();
  await expect(run).toBeEnabled();
  await run.click();
  const checkbox = page.getByRole("checkbox", { name: "るりね（人名）" });
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole("button", { name: "選択した候補を追加" })).toBeDisabled();
  await checkbox.focus(); await page.keyboard.press("Space");
  const accessibility = await new AxeBuilder({ page }).include(".additional-detection").analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: `output/playwright/prompt-ui-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "原文の次の箇所を確認" }).click();
  await page.getByRole("button", { name: "選択した候補を追加" }).click();
  await page.getByRole("tab", { name: "マスク結果", exact: true }).click();
  await expect(page.locator("#masked-panel")).toContainText("[人名_1]が来た。[人名_1]と話した。");
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: "対応表を保存", exact: true }).click();
  const save = page.getByRole("dialog", { name: "対応表を保存" });
  await save.getByLabel("対応表名", { exact: true }).fill("追加AI合成対応表");
  await save.getByLabel("パスフレーズ（12文字以上）", { exact: true }).fill("synthetic-prompt-passphrase");
  await save.getByLabel("パスフレーズ（確認）", { exact: true }).fill("synthetic-prompt-passphrase");
  await save.getByRole("button", { name: "新規に保存", exact: true }).click();
  await expect(save).toBeHidden();
  await page.reload();
  await page.getByRole("textbox", { name: "原文", exact: true }).fill(`${marker} るりねが来た。るりねと話した。`);
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: "保存済み対応表を管理", exact: true }).click();
  await page.getByRole("button", { name: "追加AI合成対応表を開く", exact: true }).click();
  const open = page.getByRole("dialog", { name: "対応表を開く" });
  await open.getByLabel("パスフレーズ", { exact: true }).fill("synthetic-prompt-passphrase");
  await open.getByRole("button", { name: "対応表を開く", exact: true }).click();
  await expect(page.getByText("形式・互換", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "マスクを復元", exact: true }).click();
  await page.getByRole("textbox", { name: "マスクを含む文章", exact: true }).fill("[人名_1]と[人名_1]");
  await expect(page.getByRole("textbox", { name: "マスクを復元した文章", exact: true })).toHaveValue("るりねとるりね");
  const storage = await page.evaluate(async () => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), databases: await indexedDB.databases(), cacheKeys: (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)))).flat() }));
  expect(JSON.stringify(storage)).not.toContain(marker);
  expect(requests.some((r) => r.includes(marker))).toBe(false);
  expect(logs.some((r) => r.includes(marker))).toBe(false);
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("menuitem", { name: "現在の作業を消去", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "現在の作業を消去", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "原文", exact: true }).locator(".cm-placeholder")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "原文", exact: true })).not.toContainText(marker);
  await expect(page.getByRole("button", { name: "有効（0）", exact: true })).toBeVisible();
});

test("追加AI: APIなしでも手動追加・既存の画面操作を継続できる", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "LanguageModel", { configurable: true, value: undefined }); });
  await page.goto("/");
  await page.getByText("追加AI検出（試験）", { exact: true }).click();
  await expect(page.getByText("この環境では追加AI検出を利用できません", { exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "原文", exact: true });
  await editor.fill("合成秘密語"); await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "選択範囲を追加", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "追加してマスク", exact: true }).click();
  await page.getByRole("tab", { name: "マスク結果", exact: true }).click();
  await expect(page.locator("#masked-panel")).toContainText("[人名_1]");
});

test("実ブラウザのPrompt API利用可否だけを確認しモデルは取得しない", async ({ page, browser, headless }, testInfo) => {
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const api = (window as typeof window & { LanguageModel?: { availability: (o: unknown) => Promise<string> } }).LanguageModel;
    return { userAgent: navigator.userAgent, hasApi: !!api, availability: api ? await api.availability({ expectedInputs: [{ type: "text", languages: ["ja"] }], expectedOutputs: [{ type: "text", languages: ["ja"] }] }).catch(() => "error") : "absent" };
  });
  await testInfo.attach("prompt-api-availability", { body: JSON.stringify({ ...state, browserVersion: browser.version(), headed: !headless }), contentType: "application/json" });
  expect(["available", "downloadable", "downloading", "unavailable", "error", "absent"]).toContain(state.availability);
});
