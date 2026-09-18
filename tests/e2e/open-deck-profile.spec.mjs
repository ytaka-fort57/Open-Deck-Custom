import { test, expect } from "./fixtures/extension-context.mjs";
import { GOLDEN_COLUMNS, goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import { expectSavedTypes, frameStyleTexts, openDeck, rackSections } from "./fixtures/deck.mjs";

const waitForSavedTypes = expectSavedTypes;
const columnSnapshot = (page) => rackSections(page);

test("profile golden path preserves iframes and round-trips storage", async ({ extensionSession }) => {
    const { context, storage, navigationCounts, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    await expect(page.locator('#first_rack_element div[opd_column_type="home"]')).toHaveAttribute("opd_column_width", "32");
    await expect(page.locator('#first_rack_element div[opd_column_type="explore"]')).toHaveAttribute("opd_explore_path", "/i/lists/42");
    await expect(page.locator('#first_rack_element div[opd_column_type="home"] .opd_tw_view_mode')).toHaveValue("1");
    await expect(page.locator('#first_rack_element div[opd_column_type="home"] .opd_a_reload_time_setting')).toHaveValue("15");
    await expect(page.locator('iframe[src="https://x.com/home"]')).toHaveCount(1);
    await expect(page.locator('iframe[src="https://x.com/i/lists/42"]')).toHaveCount(1);

    const homeFrame = page.frame({ url: "https://x.com/home" });
    const listFrame = page.frame({ url: "https://x.com/i/lists/42" });
    expect(homeFrame).not.toBeNull();
    expect(listFrame).not.toBeNull();
    await homeFrame.evaluate(() => { window.__opdE2EMarker = "home-marker"; });
    await listFrame.evaluate(() => { window.__opdE2EMarker = "list-marker"; });
    const initialNavigationCounts = new Map(navigationCounts);

    //iframe内CSSは属性ごとに<style>を1本だけ持ち、本文は保存済みの設定に従う
    //(home: banner表示・tw_view_mode=1、explore: banner非表示・tw_view_mode=0)
    const HOME_FRAME_STYLES = {
        opd_main_css: ["html{scrollbar-width:thin;}"],
        opd_banner_css: [""],
        opd_top_visible_css: [""],
        opd_tw_view_mode_css: ['div[data-testid="cellInnerDiv"]:has(div[aria-labelledby]){visibility: hidden; height: 0;}'],
    };
    const LIST_FRAME_STYLES = {
        opd_main_css: ["html{scrollbar-width:thin;}"],
        opd_banner_css: ['header[role="banner"]{display:none;}'],
        opd_top_visible_css: [""],
        opd_tw_view_mode_css: [""],
    };
    await expect.poll(() => frameStyleTexts(homeFrame)).toEqual(HOME_FRAME_STYLES);
    await expect.poll(() => frameStyleTexts(listFrame)).toEqual(LIST_FRAME_STYLES);

    await page.locator("#add_notify").click();
    await expect(page.locator('#first_rack_element div[opd_column_type="notification"]')).toHaveCount(1);
    await expect(page.locator('iframe[src="https://x.com/notifications"]')).toHaveCount(1);
    await waitForSavedTypes(storage, ["main_bar_empty_column", "home", "explore", "notification", "empty_column"]);
    expect(await homeFrame.evaluate(() => window.__opdE2EMarker)).toBe("home-marker");
    expect(await listFrame.evaluate(() => window.__opdE2EMarker)).toBe("list-marker");

    const beforeMove = await columnSnapshot(page);
    await page.locator('div[opd_column_type="home"] .opd_custom_move_right').click();
    await expect.poll(async () => (await columnSnapshot(page))
        .slice()
        .sort((left, right) => Number(left.order) - Number(right.order))
        .map((item) => item.type)
    ).toEqual(["explore", "home", "notification", "empty_column"]);
    const afterMove = await columnSnapshot(page);
    expect(afterMove.map((item) => item.id)).toEqual(beforeMove.map((item) => item.id));
    await waitForSavedTypes(storage, ["main_bar_empty_column", "explore", "home", "notification", "empty_column"]);
    expect(await homeFrame.evaluate(() => window.__opdE2EMarker)).toBe("home-marker");
    expect(await listFrame.evaluate(() => window.__opdE2EMarker)).toBe("list-marker");
    expect(navigationCounts.get("/home")).toBe(initialNavigationCounts.get("/home"));
    expect(navigationCounts.get("/i/lists/42")).toBe(initialNavigationCounts.get("/i/lists/42"));

    await page.locator('div[opd_column_type="notification"] .dsp_column_close_btn').click();
    await expect(page.locator('#first_rack_element div[opd_column_type="notification"]')).toHaveCount(0);
    await waitForSavedTypes(storage, ["main_bar_empty_column", "explore", "home", "empty_column"]);
    expect(await homeFrame.evaluate(() => window.__opdE2EMarker)).toBe("home-marker");
    expect(await listFrame.evaluate(() => window.__opdE2EMarker)).toBe("list-marker");

    const savedBeforeReload = await storage.get(["opd_profile_store"]);
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(async () => (await columnSnapshot(page)).map((item) => item.type)).toEqual(["explore", "home", "empty_column"]);
    await expect(page.locator('#first_rack_element div[opd_column_type="home"]')).toHaveAttribute("opd_column_width", "32");
    await expect(page.locator('#first_rack_element div[opd_column_type="home"] .opd_tw_view_mode')).toHaveValue("1");
    await expect(page.locator('#first_rack_element div[opd_column_type="home"] .opd_a_reload_bar')).toBeChecked();
    await expect(page.locator('#first_rack_element div[opd_column_type="home"] .opd_a_reload_time_setting')).toHaveValue("15");
    await expect(page.locator('#first_rack_element div[opd_column_type="explore"]')).toHaveAttribute("opd_column_width", "34");
    await expect(page.locator('#first_rack_element div[opd_column_type="explore"]')).toHaveAttribute("opd_explore_path", "/i/lists/42");
    await expect(page.locator('#first_rack_element div[opd_column_type="explore"]')).toHaveAttribute("opd_explore_title", "List 42");
    const restoredProfile = JSON.parse(savedBeforeReload.opd_profile_store)[0].profile;
    expect(restoredProfile.map((column) => column.type)).toEqual(["main_bar_empty_column", "explore", "home", "empty_column"]);
    expect(restoredProfile.find((column) => column.type === "home")).toMatchObject({ column_width: "32", tw_view_mode: "1", auto_reload: true, auto_reload_time: 15_000 });
    expect(restoredProfile.find((column) => column.type === "explore")).toMatchObject({ column_width: "34", column_save_path: "/i/lists/42", column_save_title: "List 42" });
    const restoredHome = page.frame({ url: "https://x.com/home" });
    const restoredList = page.frame({ url: "https://x.com/i/lists/42" });
    expect(await restoredHome.evaluate(() => window.__opdE2EMarker)).toBeUndefined();
    expect(await restoredList.evaluate(() => window.__opdE2EMarker)).toBeUndefined();
    await expect.poll(() => frameStyleTexts(restoredHome)).toEqual(HOME_FRAME_STYLES);
    await expect.poll(() => frameStyleTexts(restoredList)).toEqual(LIST_FRAME_STYLES);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
    expect(GOLDEN_COLUMNS.map((column) => column.type)).toEqual(["main_bar_empty_column", "home", "explore", "empty_column"]);
});
