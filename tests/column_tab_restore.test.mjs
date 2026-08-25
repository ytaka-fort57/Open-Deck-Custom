import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadSelectors() {
    const context = { URL, window: {} };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/selectors.js", "utf8"), context);
    return context.window.opd_custom_selectors;
}

function createDoc(pathname) {
    return { location: { pathname } };
}

function createTab(href) {
    if (href == null) {
        return { tagName: "DIV", querySelector: () => null, closest: () => null };
    }
    return {
        tagName: "A",
        baseURI: "https://x.com/home",
        getAttribute: (name) => (name === "href" ? href : null),
        querySelector: () => null,
        closest: () => null,
    };
}

test("only tabs that change the URL are treated as navigating", () => {
    const selectors = loadSelectors();
    const doc = createDoc("/home");

    // The For you / Following tabs stay on /home and never touch the history.
    assert.equal(selectors.navigates(doc, createTab(null)), false);
    assert.equal(selectors.navigates(doc, createTab("/home")), false);
    // A pinned list tab navigates the column and adds a joint session history entry.
    assert.equal(selectors.navigates(doc, createTab("/i/lists/12345")), true);
    assert.equal(selectors.tab_path(createTab("/i/lists/12345")), "/i/lists/12345");
});

test("a nested anchor inside the tab is still detected", () => {
    const selectors = loadSelectors();
    const anchor = createTab("/i/lists/999");
    const tab = { tagName: "DIV", querySelector: () => anchor, closest: () => null };
    assert.equal(selectors.navigates(createDoc("/home"), tab), true);
});

test("tab restore spends at most one navigation per column", () => {
    const customIndex = readFileSync("extensions/custom/index.js", "utf8");
    // Repeating a navigating restore would keep stealing the joint session history
    // from whichever column the user is actually reading.
    assert.match(customIndex, /function restore_tab\(doc, desired, target\)/);
    assert.match(customIndex, /if\(desired\.navigated\)\{\s*\n\s*return false;/);
    assert.match(customIndex, /desired\.navigated = true;/);
    assert.doesNotMatch(customIndex, /selectors\.click_tab\(target\);\s*\n\s*\}, INTERVAL_MS\);/);
});

test("column history tracking restarts after the iframe is reconnected", () => {
    const customIndex = readFileSync("extensions/custom/index.js", "utf8");
    // KEYS_ATTR stays on the element across a rack move, so tracking must not be
    // guarded by it or the column loses Backspace for good.
    const track_index = customIndex.indexOf("column_history.track(iframe);");
    const guard_index = customIndex.indexOf("if(iframe.getAttribute(KEYS_ATTR) != null)");
    assert.ok(track_index > 0 && guard_index > track_index);
});
