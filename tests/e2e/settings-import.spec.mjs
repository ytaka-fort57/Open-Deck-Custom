import { test, expect } from "./fixtures/extension-context.mjs";
import { GOLDEN_COLUMNS, NOTIFICATION_PROFILE_COLUMNS, storageItems } from "./fixtures/storage-fixtures.mjs";
import { openDeck, savedProfiles, visualTypes } from "./fixtures/deck.mjs";

//デッキはプロファイル一覧をメモリに持ち、変更のたびに全体を書き戻す。
//開いたまま設定をインポートしたとき、デッキの自動保存がインポート内容を消さないことを見る。
test("an open deck reloads after a settings import instead of overwriting it", async ({ extensionSession }) => {
    const { context, extensionId, storage, blockedRequests, errors } = extensionSession;
    const deck = await openDeck(context, storage, storageItems([GOLDEN_COLUMNS]));
    expect(await visualTypes(deck)).toEqual(["home", "explore", "empty_column"]);

    const importer = await context.newPage();
    importer.on("dialog", (dialog) => dialog.accept());
    await importer.goto(`chrome-extension://${extensionId}/extensions/custom/settings_import.html`);
    await importer.locator("#import_input_area").fill(JSON.stringify([
        { name: "imported", profile: NOTIFICATION_PROFILE_COLUMNS },
    ]));
    await importer.locator("#import_btn").click();
    await expect(importer.locator("#import_status")).toContainText("インポートが完了しました");

    //開いていたデッキはインポート内容で描き直される
    await expect.poll(() => visualTypes(deck)).toEqual(["notification", "empty_column"]);

    //その後のデッキの保存はインポートしたプロファイルへの変更になる。
    //読み込み直さなければ、インポート前の構成(home, explore)に explore を足したものが書き戻される
    //(名前は本家の保存が常に "user_profile" へ書き換えるため比べない)
    await deck.locator("#add_explore").click();
    await expect.poll(async () => (await savedProfiles(storage)).map((profile) => profile.profile.map((item) => item.type)))
        .toEqual([["main_bar_empty_column", "notification", "explore", "empty_column"]]);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});

test("an invalid import is rejected without touching the saved deck", async ({ extensionSession }) => {
    const { context, extensionId, storage, errors } = extensionSession;
    await storage.set(storageItems([GOLDEN_COLUMNS]));
    const before = await savedProfiles(storage);

    const importer = await context.newPage();
    importer.on("dialog", (dialog) => dialog.accept());
    await importer.goto(`chrome-extension://${extensionId}/extensions/custom/settings_import.html`);
    await importer.locator("#import_btn").click();
    await expect(importer.locator("#import_status")).toHaveText("JSONが入力されていません。");
    await importer.locator("#import_input_area").fill("{\"format\": \"something-else\"}");
    await importer.locator("#import_btn").click();
    await expect(importer.locator("#import_status")).toContainText("Open-Deckの設定として解釈できません");

    expect(await savedProfiles(storage)).toEqual(before);
    expect(errors, "console/page errors").toEqual([]);
});
