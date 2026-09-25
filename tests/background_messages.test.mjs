import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadBackground() {
    let messageListener;
    let reloadCount = 0;
    let fetchCount = 0;
    let headerFilter;
    let dnrUpdate;
    let sessionRules = [];
    const tabListeners = { removed: [], updated: [] };
    const context = {
        URL,
        AbortController,
        console: { log() {}, error() {} },
        setTimeout,
        clearTimeout,
        fetch: async () => {
            fetchCount += 1;
            return { ok: true, json: async () => ({ indications: [] }) };
        },
        chrome: {
            runtime: {
                id: "self-extension",
                getURL: () => "chrome-extension://self-extension/",
                reload: () => { reloadCount += 1; },
                onInstalled: { addListener() {} },
                onMessage: { addListener: (listener) => { messageListener = listener; } },
            },
            declarativeNetRequest: {
                updateDynamicRules: async (update) => { dnrUpdate = update; },
                getSessionRules: async () => structuredClone(sessionRules),
                updateSessionRules: async ({ removeRuleIds, addRules }) => {
                    sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(structuredClone(addRules));
                },
            },
            tabs: {
                TAB_ID_NONE: -1,
                onRemoved: { addListener: (listener) => tabListeners.removed.push(listener) },
                onUpdated: { addListener: (listener) => tabListeners.updated.push(listener) },
            },
            storage: { local: { set: (value, callback) => callback() } },
            webRequest: { onHeadersReceived: { addListener: (_listener, filter) => { headerFilter = filter; } } },
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("background.js", "utf8"), context);
    return {
        send: (request, sender, response) => messageListener(request, sender, response),
        getReloadCount: () => reloadCount,
        getFetchCount: () => fetchCount,
        getHeaderFilter: () => headerFilter,
        getDnrUpdate: () => dnrUpdate,
        getSessionRules: () => sessionRules,
        removeTab: (tabId) => tabListeners.removed.forEach((listener) => listener(tabId, {})),
        updateTab: (tabId, changeInfo, tab) => tabListeners.updated.forEach((listener) => listener(tabId, changeInfo, tab)),
    };
}

test("background rejects foreign senders before privileged actions", () => {
    const background = loadBackground();
    const responses = [];
    assert.equal(
        background.send({ message: "text_review", review_text: "test" }, { id: "other-extension" }, (value) => responses.push(value)),
        false
    );
    assert.deepEqual(responses, [false]);
    assert.equal(background.getFetchCount(), 0);

    background.send({ message: "ext_reload" }, { id: "self-extension" }, () => {});
    assert.equal(background.getReloadCount(), 1);
});

test("text review sends only non-empty strings within the post length limit", () => {
    const background = loadBackground();
    const self = { id: "self-extension" };
    for (const review_text of [undefined, null, 42, { text: "x" }, ["x"], "", "a".repeat(25001)]) {
        const responses = [];
        assert.equal(background.send({ message: "text_review", review_text }, self, (value) => responses.push(value)), false);
        assert.deepEqual(responses, [false], String(review_text).slice(0, 20));
    }
    assert.equal(background.getFetchCount(), 0);

    assert.equal(background.send({ message: "text_review", review_text: "a".repeat(25000) }, self, () => {}), true);
    assert.equal(background.getFetchCount(), 1);
});

test("API limit monitoring covers both x.com and twitter.com timelines", () => {
    const urls = loadBackground().getHeaderFilter().urls;
    for (const host of ["x.com", "twitter.com"]) {
        for (const name of ["SearchTimeline", "HomeLatestTimeline", "HomeTimeline"]) {
            assert.ok(urls.includes(`*://${host}/i/api/graphql/*/${name}*`), `${host} ${name}`);
        }
    }
});

const self = { id: "self-extension" };
const deckSender = (tabId, url = "https://x.com/run-opdeck") => ({ ...self, tab: { id: tabId }, frameId: 0, url });
const sendDnrUpdate = (background, sender) => new Promise((resolve) => background.send({ message: "dnr_upd" }, sender, resolve));
//イベントから始めた非同期の更新が終わるのを待つ
const flush = () => new Promise((resolve) => setImmediate(resolve));
const columnTabIds = (background) => background.getSessionRules().find((rule) => rule.id === 10)?.condition.tabIds ?? [];

test("CSP removal without a tab is limited to the deck page itself", async () => {
    const background = loadBackground();
    assert.equal(await sendDnrUpdate(background, self), true);
    const { removeRuleIds, addRules } = background.getDnrUpdate();
    assert.ok(removeRuleIds.includes(1), "stale tab-independent column rule is removed");
    assert.equal(addRules.length, 1);
    const { condition } = addRules[0];
    assert.deepEqual([...condition.resourceTypes].sort(), ["main_frame", "other", "xmlhttprequest"]);
    assert.equal(condition.requestDomains, undefined);
    const deckPage = new RegExp(condition.regexFilter);
    for (const url of ["https://x.com/run-opdeck", "https://twitter.com/run-opdeck", "https://x.com/run-opdeck/", "https://x.com/run-opdeck?mx=1", "https://www.x.com/run-opdeck"]) {
        assert.ok(deckPage.test(url), url);
    }
    for (const url of ["https://x.com/home", "https://x.com/run-opdeck/status/1", "https://x.com/run-opdeckx", "https://x.com/user/run-opdeck", "https://evil.example/https://x.com/run-opdeck", "https://evilx.com/run-opdeck", "http://x.com/run-opdeck"]) {
        assert.ok(!deckPage.test(url), url);
    }
    //デッキのタブがなければカラム用のルールは置かない
    assert.deepEqual(background.getSessionRules(), []);
});

test("column CSP removal applies only while a deck tab is open", async () => {
    const background = loadBackground();
    assert.equal(await sendDnrUpdate(background, deckSender(5)), true);
    const rules = background.getSessionRules();
    const frameRule = rules.find((rule) => rule.id === 10);
    assert.deepEqual([...frameRule.condition.resourceTypes], ["sub_frame"]);
    assert.deepEqual([...frameRule.condition.tabIds], [5]);
    //X のサービスワーカーが中継する要求はタブに属さない
    const workerRule = rules.find((rule) => rule.id === 11);
    assert.deepEqual([...workerRule.condition.resourceTypes].sort(), ["other", "xmlhttprequest"]);
    assert.deepEqual([...workerRule.condition.tabIds], [-1]);
    for (const rule of rules) {
        assert.ok(!rule.condition.resourceTypes.includes("main_frame"));
    }

    await sendDnrUpdate(background, deckSender(7, "https://x.com/run-opdeck?mx=1"));
    await sendDnrUpdate(background, deckSender(5));
    assert.deepEqual([...columnTabIds(background)].sort(), [5, 7]);

    background.removeTab(5);
    await flush();
    assert.deepEqual([...columnTabIds(background)], [7]);

    //デッキの再読み込みでは外さず、デッキ以外へ移動したら外す
    background.updateTab(7, { status: "loading" }, { url: "https://x.com/run-opdeck" });
    await flush();
    assert.deepEqual([...columnTabIds(background)], [7]);
    background.updateTab(7, { status: "loading", url: "https://x.com/home" }, { url: "https://x.com/home" });
    await flush();
    assert.deepEqual(background.getSessionRules(), []);
});

test("only the deck page's top frame can register its tab for column CSP removal", async () => {
    const background = loadBackground();
    for (const sender of [
        deckSender(3, "https://x.com/home"),
        { ...deckSender(3), frameId: 1 },
        { ...self, url: "https://x.com/run-opdeck" },
    ]) {
        assert.equal(await sendDnrUpdate(background, sender), true);
        assert.deepEqual(background.getSessionRules(), [], JSON.stringify(sender));
    }
});
