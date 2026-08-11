import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadBackground() {
    let messageListener;
    let reloadCount = 0;
    let fetchCount = 0;
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
            webRequest: { onHeadersReceived: { addListener() {} } },
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("background.js", "utf8"), context);
    return {
        send: (request, sender, response) => messageListener(request, sender, response),
        getReloadCount: () => reloadCount,
        getFetchCount: () => fetchCount,
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
