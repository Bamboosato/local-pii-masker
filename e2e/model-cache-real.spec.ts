import { expect, test } from "@playwright/test";
import { MODEL_ASSET_BASE, MODEL_CACHE_NAME, REQUIRED_MODEL_FILES } from "../src/domain/detection/ner/modelCache";

// Explicit opt-in: downloads ~279MB from the public model provider. Keep normal
// CI deterministic; do not confuse simulated failures with real offline NER.
test("公開モデルの取得・キャッシュと新Workerでのオフライン推論を確認する", async ({ context, page }) => {
  test.skip(process.env.RUN_REAL_NER_E2E !== "1", "公開モデルの大容量取得は明示実行時のみ");
  test.setTimeout(300_000);
  const warnings: string[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.method() + request.url() + (request.postData() ?? "")));
  const text = "山田太郎さんが東京都新宿区の会社へ連絡しました。連絡先は synthetic-ner-marker@example.test です。";
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Local PII Masker" })).toBeVisible();
  await page.getByRole("textbox", { name: "原文", exact: true }).fill(text);
  await page.getByRole("button", { name: "自動検出", exact: true }).click();
  await expect(page.locator(".entry-card").getByText("AI検出", { exact: true }).first()).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("button", { name: "中止", exact: true })).toBeHidden({ timeout: 60_000 });
  const cache = await page.evaluate(async ({ name, base, files }) => {
    const cache = await caches.open(name);
    const present = [];
    for (const file of files) present.push(Boolean((await cache.match(base + file))?.ok));
    return { present, estimate: await navigator.storage.estimate(), keys: (await cache.keys()).map((key) => new URL(key.url).pathname) };
  }, { name: MODEL_CACHE_NAME, base: MODEL_ASSET_BASE, files: [...REQUIRED_MODEL_FILES] });
  await test.info().attach("model-cache-diagnostics", { body: JSON.stringify({ ...cache, warnings, errors }), contentType: "application/json" });
  const complete = cache.present.every(Boolean);
  if (!complete) {
    await expect(page.getByRole("status", { name: "PWA状態" })).toContainText("モデルキャッシュ未完了");
    test.info().annotations.push({ type: "offline-real-ner", description: "モデル保存未完了。実オフラインNER成功は未確認、縮退を検証" });
  }
  expect(warnings.some((warning) => warning.includes("Unable to add response to browser cache"))).toBe(false);
  expect(errors).toEqual([]);
  expect(requests.join("\n")).not.toContain("synthetic-ner-marker");
  expect(requests.some((request) => request.includes(`/resolve/main/`))).toBe(false);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "原文", exact: true })).not.toContainText("山田太郎");
  await page.getByRole("textbox", { name: "原文", exact: true }).fill(text);
  await page.getByRole("button", { name: "自動検出", exact: true }).click();
  if (complete) {
    await expect(page.locator(".entry-card").getByText("AI検出", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    test.info().annotations.push({ type: "offline-real-ner", description: "新Workerの実オフラインNER成功" });
  } else {
    await expect(page.getByText(/AI検出に失敗しました。形式検出のみ完了/)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".entry-card").filter({ hasText: "synthetic-ner-marker@example.test" })).toBeVisible();
    await expect(page.locator(".entry-card").getByText("AI検出", { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "中止", exact: true })).toBeHidden({ timeout: 60_000 });
  expect(errors).toEqual([]);
  await context.setOffline(false);
  if (!complete) {
    const shellBefore = await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("local-pii-masker-app-")));
    await page.getByRole("button", { name: "モデルキャッシュを削除", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "モデルキャッシュを削除しますか？" });
    await dialog.getByRole("button", { name: "モデルキャッシュを削除", exact: true }).click();
    await expect(page.getByText(/現在のモデルの公開キャッシュを削除しました/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "原文", exact: true })).toContainText("synthetic-ner-marker");
    const after = await page.evaluate(async ({ name, base, files }) => ({
      shell: (await caches.keys()).filter((name) => name.startsWith("local-pii-masker-app-")),
      present: await Promise.all(files.map(async (file) => Boolean(await (await caches.open(name)).match(base + file)))),
    }), { name: MODEL_CACHE_NAME, base: MODEL_ASSET_BASE, files: [...REQUIRED_MODEL_FILES] });
    expect(after.shell).toEqual(shellBefore);
    expect(after.present).toEqual(REQUIRED_MODEL_FILES.map(() => false));
  }
});
