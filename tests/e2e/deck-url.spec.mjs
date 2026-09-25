import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";

//twitter.com からのリダイレクトで X がクエリを付けても、デッキが起動する
test("deck starts when the URL carries a redirect query", async ({ extensionSession }) => {
    const { context, storage } = extensionSession;
    await storage.set(goldenStorageItems());
    const page = await context.newPage();
    await page.goto("https://x.com/run-opdeck?mx=1");
    await expect(page.locator("#opd_main_element")).toBeVisible();
    //カスタム版の入口(index.js)も同じ判定で起動する
    await expect(page.locator("#opd_custom_settings_import")).toHaveCount(1);
    await expect(page.locator('iframe[src="https://x.com/home"]')).toHaveCount(1);
});
