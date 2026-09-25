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
            declarativeNetRequest: { updateDynamicRules: async (update) => { dnrUpdate = update; } },
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

test("CSP removal is limited to deck columns and the deck page itself", async () => {
    const background = loadBackground();
    const ok = await new Promise((resolve) => background.send({ message: "dnr_upd" }, { id: "self-extension" }, resolve));
    assert.equal(ok, true);
    const { removeRuleIds, addRules } = background.getDnrUpdate();
    assert.deepEqual([...removeRuleIds].sort(), [...addRules.map((rule) => rule.id)].sort());

    const mainFrameRules = addRules.filter((rule) => rule.condition.resourceTypes.includes("main_frame"));
    assert.equal(mainFrameRules.length, 1);
    const { condition } = mainFrameRules[0];
    assert.deepEqual([...condition.resourceTypes], ["main_frame"]);
    const deckPage = new RegExp(condition.regexFilter);
    for (const url of ["https://x.com/run-opdeck", "https://twitter.com/run-opdeck", "https://x.com/run-opdeck/", "https://x.com/run-opdeck?mx=1", "https://www.x.com/run-opdeck"]) {
        assert.ok(deckPage.test(url), url);
    }
    for (const url of ["https://x.com/home", "https://x.com/run-opdeck/status/1", "https://x.com/run-opdeckx", "https://x.com/user/run-opdeck", "https://evil.example/https://x.com/run-opdeck", "https://evilx.com/run-opdeck", "http://x.com/run-opdeck"]) {
        assert.ok(!deckPage.test(url), url);
    }

    //カラムは X のサービスワーカー経由で xmlhttprequest / other として取得される
    for (const rule of addRules.filter((rule) => rule !== mainFrameRules[0])) {
        assert.deepEqual([...rule.condition.resourceTypes].sort(), ["other", "sub_frame", "xmlhttprequest"]);
        assert.ok(!rule.condition.resourceTypes.includes("main_frame"));
    }
});
