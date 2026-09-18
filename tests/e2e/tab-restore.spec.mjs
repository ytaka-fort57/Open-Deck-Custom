import { test, expect } from "./fixtures/extension-context.mjs";
import { TWO_TIMELINE_COLUMNS, storageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, openDeck, rackSections, savedTabState, visualTypes } from "./fixtures/deck.mjs";

const SELECTED_TAB = '[role="tab"][aria-selected="true"]';

//タイムラインカラムは本家の保存形式では型でしか区別できないため、
//選択タブの保存は「左から何番目か」を鍵にしている。
//並び替えたときに鍵を付け替えられているかまでを見る。
async function timelineSections(page) {
    const sections = await rackSections(page);
    return sections.filter((section) => section.type === "home");
}

async function sectionByWidth(page, width) {
    return (await timelineSections(page)).find((section) => section.width === width);
}

test("saved tab follows its column across reload and reorder", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems([TWO_TIMELINE_COLUMNS]));

    expect(await visualTypes(page)).toEqual(["home", "home", "empty_column"]);
    const rightColumn = await sectionByWidth(page, "31");
    const leftColumn = await sectionByWidth(page, "30");
    const rightFrame = frameForSection(page, rightColumn.id);
    const leftFrame = frameForSection(page, leftColumn.id);
    await expect(rightFrame.locator(SELECTED_TAB)).toHaveText("おすすめ");

    await rightFrame.locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabState(storage)).toEqual({ "0:1": "フォロー中" });

    //再読み込み後も、そのカラムだけが保存したタブへ戻る
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect(frameForSection(page, (await sectionByWidth(page, "31")).id).locator(SELECTED_TAB))
        .toHaveText("フォロー中");
    await expect(frameForSection(page, (await sectionByWidth(page, "30")).id).locator(SELECTED_TAB))
        .toHaveText("おすすめ");

    //並び替えで位置が変わるため、保存の鍵も付け替わる必要がある
    const movedRight = await sectionByWidth(page, "31");
    await page.locator(`#${movedRight.id} .opd_custom_move_left`).click();
    await expect.poll(() => visualTypes(page)).toEqual(["home", "home", "empty_column"]);
    await expect.poll(async () => (await timelineSections(page))
        .slice()
        .sort((left, right) => Number(left.order) - Number(right.order))
        .map((section) => section.width)).toEqual(["31", "30"]);
    await expect.poll(() => savedTabState(storage)).toEqual({ "0:0": "フォロー中" });

    //並び替え後に別カラムでタブを選んでも、動かしたカラムの保存を奪わない
    await frameForSection(page, (await sectionByWidth(page, "30")).id)
        .locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabState(storage)).toEqual({ "0:0": "フォロー中", "0:1": "フォロー中" });

    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(async () => (await timelineSections(page)).map((section) => section.width)).toEqual(["31", "30"]);
    await expect(frameForSection(page, (await sectionByWidth(page, "31")).id).locator(SELECTED_TAB))
        .toHaveText("フォロー中");
    await expect(frameForSection(page, (await sectionByWidth(page, "30")).id).locator(SELECTED_TAB))
        .toHaveText("フォロー中");

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
