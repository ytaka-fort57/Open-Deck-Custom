import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import {
    backUntilLabel,
    dragSectionOnto,
    expectSavedTypes,
    frameForSection,
    navigateColumn,
    openDeck,
    sectionIdForType,
    visualTypes,
    waitForColumnHistoryBaseline,
} from "./fixtures/deck.mjs";

//ラックをまたぐ移動はflexのorderでは表現できず、move_beforeがDOMを動かす。
//同じ段の並び替え(golden path)と違い、iframeが作り直される点までを仕様として固定する。
test("cross-rack drop moves the column and keeps its own back history", async ({ extensionSession }) => {
    const { context, storage, navigationCounts, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    await expect(page.locator('#first_rack_element div[opd_column_type="home"]')).toHaveCount(1);
    const listSectionId = await sectionIdForType(page, "explore");
    const listFrame = frameForSection(page, listSectionId);
    await listFrame.locator("#opd_fixture_post_link").evaluate(() => {
        window.__opdE2EMarker = "list-marker";
    });
    const listNavigationsBefore = navigationCounts.get("/i/lists/42");
    const homeNavigationsBefore = navigationCounts.get("/home");

    await page.locator("#second_rack").click();
    await expect(page.locator('#second_rack_element div[opd_column_type="second_empty_column"]')).toHaveCount(1);
    await expectSavedTypes(storage, ["main_bar_empty_column", "home", "explore", "empty_column", "second_empty_column"]);

    const homeSectionId = await sectionIdForType(page, "home");
    const secondEmptySectionId = await sectionIdForType(page, "second_empty_column", "#second_rack_element");
    await dragSectionOnto(page, homeSectionId, secondEmptySectionId);

    await expect(page.locator(`#second_rack_element > section#${homeSectionId}`)).toHaveCount(1);
    await expect(page.locator(`#first_rack_element > section#${homeSectionId}`)).toHaveCount(0);
    expect(await visualTypes(page)).toEqual(["explore", "empty_column"]);
    expect(await visualTypes(page, "#second_rack_element")).toEqual(["home", "second_empty_column"]);
    await expectSavedTypes(storage, ["main_bar_empty_column", "explore", "empty_column", "home", "second_empty_column"]);

    //ラックをまたぐ移動はDOM移動を伴うため、移したカラムのiframeだけが作り直される
    await expect.poll(() => navigationCounts.get("/home")).toBe(homeNavigationsBefore + 1);
    expect(navigationCounts.get("/i/lists/42")).toBe(listNavigationsBefore);
    expect(await listFrame.locator("#opd_fixture_post_link").evaluate(() => window.__opdE2EMarker)).toBe("list-marker");

    //作り直されたiframeでもカラム単位の戻るが効くこと
    const movedHomeFrame = frameForSection(page, homeSectionId);
    const movedHomePost = movedHomeFrame.locator("#opd_fixture_post_link");
    await expect(movedHomePost).toBeVisible();
    await waitForColumnHistoryBaseline(page);
    await navigateColumn(movedHomeFrame, "/status/opd-cross-rack");

    const navigationsAfterMove = navigationCounts.get("/home");
    await backUntilLabel(movedHomeFrame, () => movedHomePost.press("Backspace"), "Home");
    //擬似popstateで戻せているなら、実ナビゲーションのフォールバックは動かない
    expect(navigationCounts.get("/home")).toBe(navigationsAfterMove);

    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(() => visualTypes(page)).toEqual(["explore", "empty_column"]);
    await expect.poll(() => visualTypes(page, "#second_rack_element")).toEqual(["home", "second_empty_column"]);
    await expect(page.locator('#second_rack_element div[opd_column_type="home"]')).toHaveAttribute("opd_column_width", "32");

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

//移動したsectionは移動元ラックのstyle.orderを持ったまま移動先へ入る。
//移動先のカラムより大きいorderを持っていても、ドロップ位置どおりに表示・保存されること
test("cross-rack drop keeps the drop position when the moved column has a larger order", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    await page.locator("#second_rack").click();
    await expect(page.locator('#second_rack_element div[opd_column_type="second_empty_column"]')).toHaveCount(1);

    //同じ段の並び替えで order を振る(explore=0, home=1, empty_column=2)
    const homeSectionId = await sectionIdForType(page, "home");
    const exploreSectionId = await sectionIdForType(page, "explore");
    await dragSectionOnto(page, exploreSectionId, homeSectionId);
    expect(await visualTypes(page)).toEqual(["explore", "home", "empty_column"]);

    //order=0 の explore を2段目へ移す
    const secondEmptySectionId = await sectionIdForType(page, "second_empty_column", "#second_rack_element");
    await dragSectionOnto(page, exploreSectionId, secondEmptySectionId);
    expect(await visualTypes(page, "#second_rack_element")).toEqual(["explore", "second_empty_column"]);

    //order=1 の home を、2段目の explore(order=0) の前へ落とす
    await dragSectionOnto(page, homeSectionId, exploreSectionId);
    expect(await visualTypes(page)).toEqual(["empty_column"]);
    expect(await visualTypes(page, "#second_rack_element")).toEqual(["home", "explore", "second_empty_column"]);
    await expectSavedTypes(storage, ["main_bar_empty_column", "empty_column", "home", "explore", "second_empty_column"]);

    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(() => visualTypes(page)).toEqual(["empty_column"]);
    await expect.poll(() => visualTypes(page, "#second_rack_element")).toEqual(["home", "explore", "second_empty_column"]);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
