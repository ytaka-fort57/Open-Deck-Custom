import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadPolicy(){
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/navigation_policy.js", "utf8"), context);
    return context.window.opd_custom_navigation_policy;
}

test("navigation policy keeps the back decision table in one pure function", () => {
    const policy = loadPolicy();
    assert.equal(policy.classify_back({ source: "keyboard", key: "Backspace", is_typing: true }), "ignore");
    assert.equal(policy.classify_back({ source: "keyboard", key: "Backspace", is_typing: false }), "column");
    assert.equal(policy.classify_back({ source: "keyboard", key: "Backspace", is_media_route: true }), "native");
    assert.equal(policy.classify_back({ source: "app-bar", key: "Back", can_back: true }), "column");
    assert.equal(policy.classify_back({ source: "app-bar", key: "Back", can_back: false }), "consume");
    assert.equal(policy.classify_back({ source: "app-bar", key: "Back", is_media_route: true, can_back: true }), "native");
});
