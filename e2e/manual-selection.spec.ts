import { expect, test } from "@playwright/test";

test("文字数行の右端から原文だけを消去できる", async ({ page }, testInfo) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "原文" });
  const clear = page.getByRole("button", { name: "原文を消去" });
  const footer = page.locator(".workspace-footer");
  await expect(clear).toBeDisabled();
  await editor.fill("原文消去の合成検証です。\n2行目を含みます。");

  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await footer.evaluate((element) => {
      const button = element.querySelector("button");
      if (!button) throw new Error("The clear button must exist.");
      const bar = element.getBoundingClientRect();
      const control = button.getBoundingClientRect();
      const count = element.querySelector(".mono")?.getBoundingClientRect();
      return {
        height: bar.height,
        buttonHeight: control.height,
        rightInset: bar.right - control.right,
        inside: control.top >= bar.top && control.bottom <= bar.bottom,
        overlapsCount: !count || count.right > control.left,
      };
    });
    expect(layout.height).toBe(44);
    expect(layout.buttonHeight).toBe(32);
    expect(layout.rightInset).toBe(24);
    expect(layout.inside).toBe(true);
    expect(layout.overlapsCount).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`clear-button-${width}.png`) });
  }

  await editor.focus();
  await editor.press("Tab");
  await expect(clear).toBeFocused();
  await clear.press("Enter");
  await expect(editor.locator(".cm-placeholder")).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(clear).toBeDisabled();
  await expect(footer).toContainText("文字数: 0 / 30,000");
  await expect(page.getByRole("button", { name: "選択範囲を追加" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("original-cleared.png") });

  await editor.fill(" \n ");
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(clear).toBeDisabled();
  await page.getByRole("tab", { name: "マスク結果" }).click();
  await expect(clear).toHaveCount(0);
});

test("原文選択の緑と追加完了の青がマウス・キーボード操作に追従する", async ({ page }, testInfo) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "原文" });
  const add = page.getByRole("button", { name: "選択範囲を追加" });
  const green = "rgb(220, 252, 231)";
  const blue = "rgb(224, 235, 255)";
  await editor.fill("検証太郎と検証太郎");
  await expect(add).toBeDisabled();
  await expect(add).toHaveCSS("background-color", blue);

  await editor.press("Control+Home");
  for (let i = 0; i < 4; i += 1) await editor.press("Shift+ArrowRight");
  await expect(add).toBeEnabled();
  await expect(add).toHaveCSS("background-color", green);
  const selectionColor = await editor.evaluate((element) =>
    getComputedStyle(element.querySelector(".cm-line") ?? element, "::selection").backgroundColor,
  );
  expect(selectionColor).toBe(green);
  await page.screenshot({ path: testInfo.outputPath("selection-green.png") });

  // Mouse activation must preserve the selected range through the dialog/cancel.
  await add.click();
  const dialog = page.getByRole("dialog", { name: "マスク対象に追加" });
  await expect(dialog.getByLabel("対象の文字列")).toHaveValue("検証太郎");
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(add).toBeFocused();
  await expect(add).toHaveCSS("background-color", green);
  await page.screenshot({ path: testInfo.outputPath("cancel-selection-green.png") });

  await add.press("Enter");
  await dialog.getByRole("button", { name: "追加してマスク" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(add).toBeDisabled();
  await expect(add).toHaveCSS("background-color", blue);
  await expect(editor).toBeFocused();
  await expect(editor.locator(".original-highlight.is-approved")).toHaveCount(2);
  await expect(editor.locator(".original-highlight.is-approved").first())
    .toHaveCSS("background-color", "rgba(37, 99, 235, 0.24)");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await page.screenshot({ path: testInfo.outputPath("registered-blue.png") });

  // Re-selecting an existing target remains possible and must reuse its entry.
  const target = await editor.locator(".original-highlight.is-approved").first().boundingBox();
  if (!target) throw new Error("The registered highlight must be visible.");
  await page.mouse.move(target.x + 1, target.y + target.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 1, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(add).toHaveCSS("background-color", green);
  await page.screenshot({ path: testInfo.outputPath("registered-selection-green.png") });
  await add.click();
  await expect(dialog.getByLabel("対象の文字列")).toHaveValue("検証太郎");
  await dialog.getByRole("button", { name: "追加してマスク" }).click();
  await expect(page.getByRole("article", { name: "検証太郎、有効" })).toHaveCount(1);
  await expect(add).toBeDisabled();

  // Boundary values: whitespace only, multiple lines, then collapsed selection.
  await editor.fill(" \n検証\n太郎");
  await editor.press("Control+Home");
  await editor.press("Shift+ArrowRight");
  await expect(add).toBeDisabled();
  await expect(add).toHaveCSS("background-color", blue);
  await editor.press("Control+End");
  await editor.press("Control+Shift+Home");
  await expect(add).toBeEnabled();
  await expect(add).toHaveCSS("background-color", green);
  await editor.press("ArrowRight");
  await expect(add).toBeDisabled();
  await expect(add).toHaveCSS("background-color", blue);
});
