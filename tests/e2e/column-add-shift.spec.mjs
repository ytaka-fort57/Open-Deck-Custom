import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import { expectSavedTypes, openDeck, rackSections, visualTypes } from "./fixtures/deck.mjs";

//カラム追加はShift併用で先頭へ、通常クリックで空カラムの直前へ入る。
//挿入位置は物理DOM順ではなくflexのorderで決まるため、両方を同じ操作列で固定する。
test("shift-clicking an add button inserts the column at the head of the rack", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    expect(await visualTypes(page)).toEqual(["home", "explore", "empty_column"]);

    //Shiftありの追加。先頭のカラム(home)より前へ入る
    await page.locator("#add_notify").click({ modifiers: ["Shift"] });
    await expect.poll(() => visualTypes(page)).toEqual(["notification", "home", "explore", "empty_column"]);
    await expectSavedTypes(storage, ["main_bar_empty_column", "notification", "home", "explore", "empty_column"]);

    //Shiftなしの追加。空カラムの直前、つまり末尾へ入る
    await page.locator("#add_notify").click();
    await expect.poll(() => visualTypes(page)).toEqual(["notification", "home", "explore", "notification", "empty_column"]);
    await expectSavedTypes(storage, [
        "main_bar_empty_column",
        "notification",
        "home",
        "explore",
        "notification",
        "empty_column",
    ]);

    //保存された並びは再読み込み後も同じ順で戻る
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(() => visualTypes(page)).toEqual(["notification", "home", "explore", "notification", "empty_column"]);
    expect((await rackSections(page)).map((section) => section.type))
        .toEqual(["notification", "home", "explore", "notification", "empty_column"]);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
