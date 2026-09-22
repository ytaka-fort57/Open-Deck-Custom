import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import { expectSavedTypes, openDeck, rackSections, visualTypes } from "./fixtures/deck.mjs";

//4種類すべてが同じ追加後処理を通り、Shift併用は先頭、通常クリックは空カラム直前へ入る。
//挿入位置は物理DOM順ではなくflexのorderで決まるため、保存と再読込も同じ操作列で固定する。
test("every add button preserves normal and shift insertion through reload", async ({ extensionSession }) => {
    const { context, storage, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    let expected = ["home", "explore", "empty_column"];
    expect(await visualTypes(page)).toEqual(expected);

    const buttons = [
        ["#add_post", "post"],
        ["#add_timeline", "home"],
        ["#add_notify", "notification"],
        ["#add_explore", "explore"],
    ];
    for(const [selector, type] of buttons){
        await page.locator(selector).click({modifiers: ["Shift"]});
        expected = [type, ...expected];
        await expect.poll(() => visualTypes(page)).toEqual(expected);
        await expectSavedTypes(storage, ["main_bar_empty_column", ...expected]);

        await page.locator(selector).click();
        expected = [...expected.slice(0, -1), type, "empty_column"];
        await expect.poll(() => visualTypes(page)).toEqual(expected);
        await expectSavedTypes(storage, ["main_bar_empty_column", ...expected]);
    }

    //保存された並びは再読み込み後も同じ順で戻る
    await page.reload();
    await expect(page.locator("#opd_main_element")).toBeVisible();
    await expect.poll(() => visualTypes(page)).toEqual(expected);
    expect((await rackSections(page)).map((section) => section.type))
        .toEqual(expected);

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
