import { expect, test } from "@playwright/test";

const PRIVATE_MARKER = "pwa-private-marker-7f42";

test.describe("Phase 7 PWA", () => {
  test("ManifestとService Workerを本番ビルドから登録する", async ({ page }) => {
    const manifestResponse = await page.request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192" }),
        expect.objectContaining({ sizes: "512x512" }),
      ]),
    );

    const serviceWorkerResponse = await page.request.get("/sw.js");
    expect(serviceWorkerResponse.ok()).toBe(true);
    const serviceWorkerSource = await serviceWorkerResponse.text();
    expect(serviceWorkerSource).not.toContain("__PWA_BUILD_ID__");
    expect(serviceWorkerSource).toContain("local-pii-masker-app-");

    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    await expect(page.getByRole("status", { name: "PWA状態" })).toContainText(
      "PWA準備完了",
    );
  });

  test("ウォームキャッシュ状態ではオフライン起動して形式検出を継続できる", async ({
    context,
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Local PII Masker" })).toBeVisible();

    const cacheSnapshot = await page.evaluate(async () => {
      const names = await caches.keys();
      const entries = await Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          return {
            name,
            urls: requests.map((request) => request.url),
          };
        }),
      );
      return entries;
    });
    expect(cacheSnapshot.some((entry) => entry.name.startsWith("local-pii-masker-app-"))).toBe(
      true,
    );

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Local PII Masker" })).toBeVisible();
    await expect(page.getByRole("status", { name: "PWA状態" })).toContainText("オフライン");
    await expect(page.getByRole("button", { name: "自動検出" })).toBeVisible();
    await context.setOffline(false);
  });

  test("Cache Storageへ入力内容を保存しない", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(
        [request.method(), request.url(), request.postData() ?? ""].join("\n"),
      );
    });

    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    await page.getByRole("textbox", { name: "原文" }).fill(PRIVATE_MARKER);

    const snapshot = await page.evaluate(async () => {
      const names = await caches.keys();
      const bodies = await Promise.all(
        names.flatMap((name) =>
          caches.open(name).then(async (cache) => {
            const entries = await cache.keys();
            return Promise.all(
              entries.map(async (request) => (await cache.match(request))?.text() ?? ""),
            );
          }),
        ),
      );
      return bodies.flat().join("\n");
    });

    expect(snapshot).not.toContain(PRIVATE_MARKER);
    expect(requests.join("\n")).not.toContain(PRIVATE_MARKER);
  });
});
