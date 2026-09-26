import { test, expect } from "./fixtures/extension-context.mjs";
import { column, storageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, rackSections } from "./fixtures/deck.mjs";

const AUTO_RELOAD_COLUMNS = [
    column("main_bar_empty_column"),
    column("home", { auto_reload: false, auto_reload_time: 1_000 }),
    column("empty_column"),
];

test("auto reload enabled in the UI pauses while composing and resumes afterward", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    await storage.set(storageItems([AUTO_RELOAD_COLUMNS]));

    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.accept());
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.goto("https://x.com/run-opdeck");
    await expect(page.locator("#opd_main_element")).toBeVisible();

    const homeSection = (await rackSections(page)).find((section) => section.type === "home");
    expect(homeSection).toBeDefined();
    const homeFrame = frameForSection(page, homeSection.id);
    await expect(homeFrame.locator("html")).toHaveAttribute("data-opd-auto-reload-ready", "true");
    await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));

    const homeColumn = page.locator(`#${homeSection.id} div[opd_column_type="home"]`);
    const settingsPanel = homeColumn.locator(".dsp_column_settings_panel");
    await expect(settingsPanel).toBeHidden();
    await homeColumn.locator(".dsp_column_settings_btn").click();
    await expect(settingsPanel).toBeVisible();

    const enabled = homeColumn.locator(".opd_a_reload_bar");
    const interval = homeColumn.locator(".opd_a_reload_time_setting");
    const counter = homeFrame.locator("#opd_fixture_reload_count");
    await expect(enabled).not.toBeChecked();
    await expect(interval).toHaveValue("1");
    await expect(interval).toBeEnabled();
    await expect(counter).toHaveAttribute("data-count", "0");

    await enabled.click();
    await expect(enabled).toBeChecked();
    await expect(interval).toBeDisabled();
    await page.clock.runFor(1_000);
    await expect(counter).toHaveAttribute("data-count", "1");

    const composer = homeFrame.locator("#opd_fixture_composer");
    await composer.focus();
    await expect(composer).toBeFocused();
    await expect(homeFrame.locator("html")).toHaveAttribute("data-opd-post-focus", "true");
    await page.clock.runFor(3_000);
    await expect(counter).toHaveAttribute("data-count", "1");

    await composer.blur();
    await expect(composer).not.toBeFocused();
    await expect(homeFrame.locator("html")).toHaveAttribute("data-opd-post-focus", "false");
    await page.clock.runFor(1_000);
    await expect(counter).toHaveAttribute("data-count", "2");

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
