import { test, expect } from "./fixtures/extension-context.mjs";
import { GOLDEN_COLUMNS, NOTIFICATION_PROFILE_COLUMNS, TWO_TIMELINE_COLUMNS, storageItems } from "./fixtures/storage-fixtures.mjs";
import { frameForSection, openDeck, rackSections, savedProfiles, savedTabs, visualTypes } from "./fixtures/deck.mjs";

//本家のプロファイル切替はデッキを丸ごと作り直す。
//切り替え先が正しく描かれること、そして切り替え元の保存が壊れないことを見る。
test("switching profiles rebuilds the deck without corrupting the other profile", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems([GOLDEN_COLUMNS, NOTIFICATION_PROFILE_COLUMNS]));

    await expect(page.locator(".profile_val_now")).toHaveText("0");
    expect(await visualTypes(page)).toEqual(["home", "explore", "empty_column"]);

    await page.locator("#userProfile-1").click();
    await expect(page.locator(".profile_val_now")).toHaveText("1");
    await expect.poll(() => visualTypes(page)).toEqual(["notification", "empty_column"]);
    await expect(page.locator('#first_rack_element div[opd_column_type="notification"]')).toHaveAttribute("opd_column_width", "28");
    await expect(page.locator('iframe[src="https://x.com/home"]')).toHaveCount(0);
    await expect.poll(async () => JSON.parse((await storage.get(["opd_settings"])).opd_settings).last_load_profile).toBe(1);

    //切り替え後の保存は切り替え先だけを書き換える
    await page.locator("#add_explore").click();
    await expect(page.locator('#first_rack_element div[opd_column_type="explore"]')).toHaveCount(1);
    await expect.poll(async () => (await savedProfiles(storage))[1].profile.map((item) => item.type))
        .toEqual(["main_bar_empty_column", "notification", "explore", "empty_column"]);
    expect((await savedProfiles(storage))[0].profile.map((item) => item.type))
        .toEqual(GOLDEN_COLUMNS.map((item) => item.type));

    await page.locator("#userProfile-0").click();
    await expect(page.locator(".profile_val_now")).toHaveText("0");
    await expect.poll(() => visualTypes(page)).toEqual(["home", "explore", "empty_column"]);
    //run() は切替のたびに呼ばれるが、デッキのスタイルシートは1つのまま
    await expect(page.locator('head link[rel="stylesheet"][href$="/deck.css"]')).toHaveCount(1);
    await expect(page.locator('#first_rack_element div[opd_column_type="home"]')).toHaveAttribute("opd_column_width", "32");
    await expect(page.locator('#first_rack_element div[opd_column_type="explore"]')).toHaveAttribute("opd_explore_path", "/i/lists/42");
    await expect(page.locator('#first_rack_element div[opd_column_type="home"] .opd_a_reload_time_setting')).toHaveValue("15");

    //並び替えの保存リスナーは run() ごとに増えない。切替を2回行った後の並び替え1回で
    //opd_profile_store の書き込みが1回だけであることを storage.onChanged で見る
    const profileStoreWrites = await storage.watch("opd_profile_store");
    await page.locator('div[opd_column_type="home"] .opd_custom_move_right').click();
    await expect.poll(() => visualTypes(page)).toEqual(["explore", "home", "empty_column"]);
    await expect.poll(async () => (await savedProfiles(storage))[0].profile.map((item) => item.type))
        .toEqual(["main_bar_empty_column", "explore", "home", "empty_column"]);
    //直列化された保存が追加で走るなら、この待ちの間に2回目の onChanged が届く
    await page.waitForTimeout(500);
    expect(await profileStoreWrites.count(), "opd_profile_store writes per reorder").toBe(1);
    await profileStoreWrites.close();

    //再読み込み後も最後に開いたプロファイルが、並び替え後の順で復元される
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect(page.locator(".profile_val_now")).toHaveText("0");
    await expect.poll(() => visualTypes(page)).toEqual(["explore", "home", "empty_column"]);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

//表示中より前のプロファイルを削除すると番号が詰まるが、デッキは作り直されない。
//開いているカラムのタブ保存と、以後のプロファイル保存が詰めた後の番号へ向くことを見る。
test("deleting an earlier profile keeps the open deck saving to its shifted index", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, storageItems(
        [NOTIFICATION_PROFILE_COLUMNS, GOLDEN_COLUMNS, TWO_TIMELINE_COLUMNS],
        { last_load_profile: 2 },
    ));
    await expect(page.locator(".profile_val_now")).toHaveText("2");
    const home = (await rackSections(page)).find((section) => section.width === "31");

    //openDeck の既定ハンドラーは prompt へ空文字を返すため、削除番号を答えるものへ差し替える
    page.removeAllListeners("dialog");
    page.on("dialog", (dialog) => dialog.type() === "prompt" ? dialog.accept("0") : dialog.accept());
    await page.locator("#profile_delete").click();
    await expect(page.locator(".profile_val_now")).toHaveText("1");
    await expect.poll(async () => (await savedProfiles(storage)).length).toBe(2);
    await expect.poll(async () => JSON.parse((await storage.get(["opd_settings"])).opd_settings).last_load_profile).toBe(1);

    //読み込み済みのカラムでも、タブは詰めた後の番号で保存される
    await frameForSection(page, home.id).locator('[role="tab"]', { hasText: "フォロー中" }).click();
    await expect.poll(() => savedTabs(storage)).toEqual({ [`1:${home.uid}`]: "フォロー中" });

    //削除後の保存は表示中のプロファイルだけを書き換え、1つ前(元のP1)を壊さない
    await page.locator(`#${home.id} .opd_custom_move_left`).click();
    await expect.poll(async () => (await savedProfiles(storage))[1].profile
        .filter((item) => item.type === "home").map((item) => item.column_width))
        .toEqual(["31", "30"]);
    expect((await savedProfiles(storage))[0].profile.map((item) => item.type))
        .toEqual(GOLDEN_COLUMNS.map((item) => item.type));

    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect(page.locator(".profile_val_now")).toHaveText("1");
    const reloaded = (await rackSections(page)).find((section) => section.width === "31");
    await expect(frameForSection(page, reloaded.id).locator('[role="tab"][aria-selected="true"]')).toHaveText("フォロー中");

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
