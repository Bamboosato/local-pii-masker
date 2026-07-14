import { expect, test } from "@playwright/test";

test("開発用CSP下でReact Refreshを含む画面を表示できる", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to execute/i.test(message.text())) {
      cspErrors.push(message.text());
    }
  });

  const response = await page.goto("/");

  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Local PII Masker" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "原文" })).toBeVisible();
  expect(cspErrors).toEqual([]);
});
