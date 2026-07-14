import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PRIVATE_MARKER = "phase5-private-marker-7f42";
const PRIVATE_EMAIL = `${PRIVATE_MARKER}@example.test`;

test("CSPとセキュリティヘッダーを適用して起動できる", async ({ page }) => {
  const response = await page.goto("/");

  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");

  const metaPolicy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(metaPolicy).toContain("https://huggingface.co");
  expect(metaPolicy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(metaPolicy).not.toContain("ws://");
  await expect(page.getByRole("textbox", { name: "原文" })).toBeVisible();
});

test("入力内容を外部通信・Storage・Consoleへ出さず、NER失敗時も形式候補を保持する", async ({
  page,
}) => {
  const observedRequests: string[] = [];
  const externalRequests: string[] = [];
  const consoleMessages: string[] = [];

  page.on("request", (request) => {
    const serialized = [
      request.method(),
      request.url(),
      request.postData() ?? "",
      JSON.stringify(request.headers()),
    ].join("\n");
    observedRequests.push(serialized);
  });
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.origin !== "http://127.0.0.1:4173") {
      externalRequests.push(requestUrl.href);
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "原文" })
    .fill(`連絡先は${PRIVATE_EMAIL}です。`);
  await page.getByRole("button", { name: "自動検出" }).click();

  await expect(page.getByRole("button", { name: "再検出" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page
      .getByRole("complementary", { name: "マスク対象管理" })
      .getByText(PRIVATE_EMAIL, { exact: true }),
  ).toBeVisible();
  expect(externalRequests.length).toBeGreaterThan(0);

  const storageSnapshot = await page.evaluate(async () => {
    const localStorageEntries = Object.entries(localStorage);
    const sessionStorageEntries = Object.entries(sessionStorage);
    const databaseNames =
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map((database) => database.name ?? "")
        : [];
    const cacheNames = "caches" in window ? await caches.keys() : [];

    return JSON.stringify({
      cacheNames,
      cookie: document.cookie,
      databaseNames,
      localStorageEntries,
      sessionStorageEntries,
    });
  });

  expect(observedRequests.join("\n")).not.toContain(PRIVATE_MARKER);
  expect(consoleMessages.join("\n")).not.toContain(PRIVATE_MARKER);
  expect(storageSnapshot).not.toContain(PRIVATE_MARKER);
});

test("主要画面に自動検出可能なアクセシビリティ違反がない", async ({ page }) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
