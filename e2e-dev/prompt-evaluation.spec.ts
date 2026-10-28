import { expect, test } from "@playwright/test";

test("合成評価画面: 通常UIと分離してA/B/Cを集計・明示出力できる（モック）", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class extends EventTarget {
      postMessage(message: { id: number }) { queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "success", id: message.id, candidates: [] } }))); }
      terminate() { /* Synthetic baseline. */ }
    } as unknown as typeof Worker;
    const session = () => ({ contextWindow: 100000, contextUsage: 100, measureContextUsage: async () => 1000, addEventListener() {}, clone: async () => session(), destroy() {}, promptStreaming: () => new ReadableStream({ start(c) { c.enqueue('{"entities":[]}'); c.close(); } }) });
    Object.defineProperty(window, "LanguageModel", { value: { availability: async () => "available", create: async () => session() } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/experiments/prompt-api/");
  await page.getByLabel("ソースコミット").fill("synthetic-test-only");
  await page.getByLabel("CPU・RAM・GPU・OS・Chrome完全版・モデル版").fill("APIモック：実モデル測定ではない");
  await page.getByLabel("評価セット").selectOption("long");
  await page.getByRole("button", { name: "A/B/Cを各3回評価" }).click();
  await expect(page.getByRole("status")).toContainText("評価終了", { timeout: 30000 });
  const report = JSON.parse(await page.locator("#results").innerText());
  expect(report.completed).toBe(true);
  expect(report.rows).toHaveLength(9);
  expect(report.summary.repeats).toHaveLength(3);
  expect(report.adoption).toContain("保留");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "合成評価結果をJSON出力" }).click();
  expect((await download).suggestedFilename()).toBe("synthetic-prompt-api-evaluation.json");
  expect(errors).toEqual([]);
});
