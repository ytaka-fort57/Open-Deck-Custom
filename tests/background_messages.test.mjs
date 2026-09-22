import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadBackground() {
    let messageListener;
    let reloadCount = 0;
    let fetchCount = 0;
    let headerFilter;
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
            declarativeNetRequest: { updateDynamicRules: async () => {} },
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
