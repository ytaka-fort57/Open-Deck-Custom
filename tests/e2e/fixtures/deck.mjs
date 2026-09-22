import { expect } from "@playwright/test";

//デッキを開く。結果はDOM・URL・storageからだけ観測し、拡張内部の変数は参照しない
export async function openDeck(context, storage, items) {
    await storage.set(items);
    const page = await context.newPage();
    //プロファイル切替と2段表示の解除はconfirmを出す。既定の自動dismissだと操作が成立しない
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("https://x.com/run-opdeck");
    await expect(page.locator("#opd_main_element")).toBeVisible();
    return page;
}

export async function savedProfiles(storage) {
    const value = await storage.get(["opd_profile_store"]);
    return JSON.parse(value.opd_profile_store);
}

export async function savedProfileTypes(storage, profileIndex = 0) {
    return (await savedProfiles(storage))[profileIndex].profile.map((item) => item.type);
}

export async function expectSavedTypes(storage, expected, profileIndex = 0) {
    await expect.poll(() => savedProfileTypes(storage, profileIndex)).toEqual(expected);
}

export async function savedTabState(storage) {
    const value = await storage.get(["opd_custom_column_state"]);
    return value.opd_custom_column_state == null ? {} : JSON.parse(value.opd_custom_column_state);
}

//移行後の保存は {schema_version, tabs}。鍵の右側はカラム固有の安定ID
export async function savedTabs(storage) {
    const state = await savedTabState(storage);
    return state.tabs == null ? state : state.tabs;
}

//表示中のカラムに付いている安定ID。保存の鍵と突き合わせる
export async function columnUid(page, sectionId) {
    return page.locator(`#${sectionId} div[opd_column_type]`).getAttribute("opd_custom_uid");
}

//カラムiframeのheadにある拡張のstyleを属性ごとに集める。1本ずつであることと本文を同時に見る
export function frameStyleTexts(frame) {
    return frame.evaluate(() => Object.fromEntries(
        ["opd_main_css", "opd_banner_css", "opd_top_visible_css", "opd_tw_view_mode_css"].map((attr) => [
            attr,
            Array.from(document.head.querySelectorAll(`style[${attr}]`)).map((style) => style.textContent),
        ])
    ));
}

//sectionの物理DOM順と、flexのorderで決まる表示順を分けて観測する
export function rackSections(page, rackSelector = "#first_rack_element") {
    return page.locator(`${rackSelector} > section`).evaluateAll((sections) => sections.map((section) => ({
        id: section.id,
        type: section.querySelector("div[opd_column_type]")?.getAttribute("opd_column_type"),
        uid: section.querySelector("div[opd_column_type]")?.getAttribute("opd_custom_uid"),
        width: section.querySelector("div[opd_column_type]")?.getAttribute("opd_column_width"),
        order: section.style.order,
    })));
}

export async function visualTypes(page, rackSelector = "#first_rack_element") {
    const sections = await rackSections(page, rackSelector);
    return sections
        .slice()
        .sort((left, right) => Number(left.order) - Number(right.order))
        .map((section) => section.type);
}

//本家のdropハンドラーへ実際に乗せる。ラックをまたぐ移動はこの経路でしか起きない
export async function dragSectionOnto(page, sourceId, targetId) {
    await page.evaluate(({ source: sourceSelector, target: targetSelector }) => {
        const source = document.getElementById(sourceSelector);
        const target = document.getElementById(targetSelector);
        const dataTransfer = new DataTransfer();
        const fire = (element, type) => element.dispatchEvent(new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
        }));
        fire(source, "dragstart");
        fire(target, "dragover");
        fire(target, "drop");
    }, { source: sourceId, target: targetId });
}

export async function sectionIdForType(page, type, rackSelector = "#first_rack_element") {
    const sections = await rackSections(page, rackSelector);
    return sections.find((section) => section.type === type)?.id;
}

//同じURLのカラムが複数あるため、frameはsectionから辿る
export function frameForSection(page, sectionId) {
    return page.frameLocator(`#${sectionId} iframe`);
}

//そのカラムが今どこを表示しているか。fixtureのルーターがpathを書き込む
export function columnLabel(frame) {
    return frame.locator('[data-testid="primaryColumn"] > div[tabindex="0"]');
}

export async function navigateColumn(frame, path) {
    await columnLabel(frame).evaluate((element, target) => {
        element.ownerDocument.defaultView.opdFixtureNavigate(target);
    }, path);
    await expect(columnLabel(frame)).toHaveAttribute("aria-label", path);
}

//独自履歴はiframeのURLを周期監視して積む(column_history.js の WATCH_INTERVAL_MS)。
//現在地が1度も記録される前に遷移させると、そのカラムは戻り先を持たないまま進んでしまう。
//スタックはDOM・URL・storageのどれにも出ないため、観測できる代わりに監視周期分を待つ。
const HISTORY_WATCH_INTERVAL_MS = 400;

export async function waitForColumnHistoryBaseline(page) {
    await page.waitForTimeout(HISTORY_WATCH_INTERVAL_MS * 3);
}

//独自履歴はiframeのURLを周期監視して積むため、遷移直後はまだ戻り先を持たない。
//待ち時間を固定値で埋めず、戻れるようになるまで同じユーザー操作を繰り返す。
//戻る処理中と履歴を使い切った後はどちらも無視されるため、押し過ぎにはならない。
export async function backUntilLabel(frame, action, expectedLabel) {
    await expect.poll(async () => {
        await action();
        return columnLabel(frame).getAttribute("aria-label");
    }, { timeout: 15_000, intervals: [200] }).toBe(expectedLabel);
}
