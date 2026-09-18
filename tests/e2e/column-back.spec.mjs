import { test, expect } from "./fixtures/extension-context.mjs";
import { goldenStorageItems } from "./fixtures/storage-fixtures.mjs";
import {
    backUntilLabel,
    columnLabel,
    frameForSection,
    navigateColumn,
    openDeck,
    sectionIdForType,
    waitForColumnHistoryBaseline,
} from "./fixtures/deck.mjs";

//ブラウザーの戻るはフレームをまたぐjoint session historyを動かすため、
//押したカラム以外が戻ってしまう。独自履歴がその分離を保てているかを見る。
test("column back moves only the column that received the operation", async ({ extensionSession }) => {
    const { context, storage, navigationCounts, blockedRequests, errors } = extensionSession;
    const page = await openDeck(context, storage, goldenStorageItems());

    const homeSectionId = await sectionIdForType(page, "home");
    const listSectionId = await sectionIdForType(page, "explore");
    const homeFrame = frameForSection(page, homeSectionId);
    const listFrame = frameForSection(page, listSectionId);
    await expect(columnLabel(homeFrame)).toHaveAttribute("aria-label", "Home");
    await expect(columnLabel(listFrame)).toHaveAttribute("aria-label", "List 42");
    await waitForColumnHistoryBaseline(page);

    await navigateColumn(homeFrame, "/status/opd-home");
    await navigateColumn(listFrame, "/status/opd-list");
    const homeNavigations = navigationCounts.get("/home");
    const listNavigations = navigationCounts.get("/i/lists/42");

    //Backspaceはフォーカスのあるカラムにだけ効く
    const homePost = homeFrame.locator('article[data-testid="tweet"]').first();
    await backUntilLabel(homeFrame, () => homePost.press("Backspace"), "Home");
    await expect(columnLabel(listFrame)).toHaveAttribute("aria-label", "/status/opd-list");

    //画面上の戻るボタンも、押したカラムだけを戻す
    await backUntilLabel(
        listFrame,
        () => listFrame.locator('button[data-testid="app-bar-back"]').click({ timeout: 2_000 }).catch(() => {}),
        "List 42",
    );
    await expect(columnLabel(homeFrame)).toHaveAttribute("aria-label", "Home");

    //擬似popstateで戻せていれば、戻り先URLの読み込みへは落ちない
    expect(navigationCounts.get("/home")).toBe(homeNavigations);
    expect(navigationCounts.get("/i/lists/42")).toBe(listNavigations);
    expect(page.url()).toBe("https://x.com/run-opdeck");

    //メディアURLはX標準のjoint historyに任せ、独自履歴は介入しない
    await navigateColumn(homeFrame, "/status/opd-home/photo/1");
    await homePost.press("Backspace");
    await expect(columnLabel(homeFrame)).toHaveAttribute("aria-label", "/status/opd-home/photo/1");

    expect(blockedRequests, "fixture外network request").toEqual([]);
    expect(errors, "console/page errors").toEqual([]);
});
