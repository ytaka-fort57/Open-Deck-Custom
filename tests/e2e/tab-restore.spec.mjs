import { test, expect } from "./fixtures/extension-context.mjs";
import { TWO_TIMELINE_COLUMNS, legacyTabStateItems, storageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, openDeck, rackSections, savedTabs, visualTypes } from "./fixtures/deck.mjs";

const SELECTED_TAB = '[role="tab"][aria-selected="true"]';

//タイムラインカラムは本家の保存形式では型でしか区別できないため、
//選択タブの保存はカラム固有の安定ID(opd_custom_uid)を鍵にしている。
//並び替えても鍵が変わらないこと、削除しても残りのカラムの保存が動かないことまでを見る。
async function timelineSections(page) {
    const sections = await rackSections(page);
    return sections.filter((section) => section.type === "home");
}

async function sectionByWidth(page, width) {
    return (await timelineSections(page)).find((section) => section.width === width);
}

async function selectedTabOfWidth(page, width) {
    return frameForSection(page, (await sectionByWidth(page, width)).id).locator(SELECTED_TAB);
}

test("saved tab follows its column across reload and reorder", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems([TWO_TIMELINE_COLUMNS]));

    expect(await visualTypes(page)).toEqual(["home", "home", "empty_column"]);
    const rightUid = (await sectionByWidth(page, "31")).uid;
    const leftUid = (await sectionByWidth(page, "30")).uid;
    expect(rightUid, "描画時に安定IDが発行される").toBeTruthy();
    expect(rightUid).not.toEqual(leftUid);
    await expect(await selectedTabOfWidth(page, "31")).toHaveText("おすすめ");

    await frameForSection(page, (await sectionByWidth(page, "31")).id)
        .locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabs(storage)).toEqual({ [`0:${rightUid}`]: "フォロー中" });

    //再読み込み後も、そのカラムだけが保存したタブへ戻る。IDも変わらない
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    expect((await sectionByWidth(page, "31")).uid).toEqual(rightUid);
    await expect(await selectedTabOfWidth(page, "31")).toHaveText("フォロー中");
    await expect(await selectedTabOfWidth(page, "30")).toHaveText("おすすめ");

    //並び替えても鍵はカラムに付いたままなので、保存は書き換わらない
    const movedRight = await sectionByWidth(page, "31");
    await page.locator(`#${movedRight.id} .opd_custom_move_left`).click();
    await expect.poll(() => visualTypes(page)).toEqual(["home", "home", "empty_column"]);
    await expect.poll(async () => (await timelineSections(page))
        .slice()
        .sort((left, right) => Number(left.order) - Number(right.order))
        .map((section) => section.width)).toEqual(["31", "30"]);
    await expect.poll(() => savedTabs(storage)).toEqual({ [`0:${rightUid}`]: "フォロー中" });

    //並び替え後に別カラムでタブを選んでも、動かしたカラムの保存を奪わない
    await frameForSection(page, (await sectionByWidth(page, "30")).id)
        .locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabs(storage))
        .toEqual({ [`0:${rightUid}`]: "フォロー中", [`0:${leftUid}`]: "フォロー中" });

    //並び替えた状態のまま読み込み直しても、どちらのカラムも自分の保存へ戻る
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(async () => (await timelineSections(page)).map((section) => section.width)).toEqual(["31", "30"]);
    await expect(await selectedTabOfWidth(page, "31")).toHaveText("フォロー中");
    await expect(await selectedTabOfWidth(page, "30")).toHaveText("フォロー中");

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("deleting a column leaves the remaining column's tab in place", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems([TWO_TIMELINE_COLUMNS]));

    const rightUid = (await sectionByWidth(page, "31")).uid;
    const leftUid = (await sectionByWidth(page, "30")).uid;
    await frameForSection(page, (await sectionByWidth(page, "31")).id)
        .locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabs(storage)).toEqual({ [`0:${rightUid}`]: "フォロー中" });

    //左のカラムを消しても、右のカラムの鍵は位置ではないので動かない
    const left = await sectionByWidth(page, "30");
    await page.locator(`#${left.id} .dsp_column_close_btn`).click();
    await expect.poll(() => visualTypes(page)).toEqual(["home", "empty_column"]);
    await expect.poll(() => savedTabs(storage)).toEqual({ [`0:${rightUid}`]: "フォロー中" });
    expect((await sectionByWidth(page, "31")).uid).toEqual(rightUid);

    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    expect((await sectionByWidth(page, "31")).uid).toEqual(rightUid);
    await expect(await selectedTabOfWidth(page, "31")).toHaveText("フォロー中");
    expect(await savedTabs(storage)).not.toHaveProperty(`0:${leftUid}`);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("a position-keyed save from an older version is migrated on the first run", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    //"0:1" は2本目のタイムラインカラム(幅31)を指す。旧鍵はタイムラインだけを数えていた
    const page = await openDeck(
        context,
        storage,
        legacyTabStateItems([TWO_TIMELINE_COLUMNS], { "0:1": "フォロー中", "0:9": "消えたカラム" })
    );

    const rightUid = (await sectionByWidth(page, "31")).uid;
    expect(rightUid).toBeTruthy();
    //どのカラムも指さない鍵は捨て、残りはIDへ読み替える
    await expect.poll(() => savedTabs(storage)).toEqual({ [`0:${rightUid}`]: "フォロー中" });
    await expect(await selectedTabOfWidth(page, "31")).toHaveText("フォロー中");
    await expect(await selectedTabOfWidth(page, "30")).toHaveText("おすすめ");

    //版を戻すときに書き戻せるよう、移行前の保存を控えとして残す
    const legacy = await storage.get(["opd_custom_column_state_v1"]);
    expect(JSON.parse(legacy.opd_custom_column_state_v1))
        .toEqual({ "0:1": "フォロー中", "0:9": "消えたカラム" });

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("tabs on pages other than the home timeline neither overwrite nor get re-selected", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems([TWO_TIMELINE_COLUMNS]));
    const uid = (await sectionByWidth(page, "31")).uid;

    await frameForSection(page, (await sectionByWidth(page, "31")).id)
        .locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabs(storage)).toEqual({ [`0:${uid}`]: "フォロー中" });

    //読み込み直後の再選択期間(20秒)中に、同名のタブを持つ別ページへ移る
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    const frame = frameForSection(page, (await sectionByWidth(page, "31")).id);
    await expect(frame.locator(SELECTED_TAB)).toHaveText("フォロー中");
    await frame.locator("body").evaluate(() => window.opdFixtureNavigate("/Alice/followers"));
    await frame.locator('[role="tab"]', { hasText: "おすすめ" }).click();
    await expect(frame.locator(SELECTED_TAB)).toHaveText("おすすめ");

    //再選択の監視は1秒周期のため、2周期以上待っても押し戻されず、保存も変わらないことを見る
    await page.waitForTimeout(2500);
    await expect(frame.locator(SELECTED_TAB)).toHaveText("おすすめ");
    expect(await savedTabs(storage)).toEqual({ [`0:${uid}`]: "フォロー中" });

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
