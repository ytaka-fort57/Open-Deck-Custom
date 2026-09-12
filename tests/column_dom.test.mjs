import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class FrameFixture {
    constructor() {
        this.listeners = new Map();
        this.src = "https://x.com/home";
        this.contentWindow = {
            document: {
                querySelector: () => {
                    throw new Error("cross-origin during navigation");
                },
            },
        };
    }

    addEventListener(name, callback) {
        const callbacks = this.listeners.get(name) ?? [];
        callbacks.push(callback);
        this.listeners.set(name, callbacks);
    }

    removeEventListener(name, callback) {
        const callbacks = this.listeners.get(name) ?? [];
        this.listeners.set(name, callbacks.filter((item) => item !== callback));
    }

    dispatch(name) {
        for (const callback of this.listeners.get(name) ?? []) {
            callback();
        }
    }
}

function loadColumnDom() {
    const context = {
        window: {},
        setTimeout: () => 0,
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/column_dom.js", "utf8"), context);
    return context.window.opd_custom_column_dom;
}

test("column DOM boundary chooses an insertion target and delegates visual reorder", () => {
    const columnDom = loadColumnDom();
    const regularColumn = {
        tagName: "SECTION",
        getAttribute: (name) => name === "draggable" ? "true" : null,
    };
    const emptyColumn = {
        tagName: "SECTION",
    };
    emptyColumn.parentElement = { children: [regularColumn, emptyColumn] };
    const document = { querySelector: () => emptyColumn };

    assert.equal(columnDom.get_add_target(document, false), emptyColumn);
    assert.equal(columnDom.get_add_target(document, true), regularColumn);

    const newColumn = { id: "new-column" };
    const calls = [];
    const target = {
        previousElementSibling: null,
        insertAdjacentHTML: (position, html) => {
            calls.push([position, html]);
            target.previousElementSibling = newColumn;
        },
    };
    const reorder = {
        move_before: (section, insertionTarget) => {
            calls.push(["move_before", section, insertionTarget]);
        },
    };

    assert.equal(columnDom.insert_before_target(target, "<section></section>", reorder), newColumn);
    assert.deepEqual(calls, [
        ["beforebegin", "<section></section>"],
        ["move_before", newColumn, target],
    ]);
});

test("column removal disposes resources before removing the DOM node", () => {
    const columnDom = loadColumnDom();
    const events = [];
    const column = { remove: () => events.push("remove") };
    const lifecycle = { dispose_column_resources_in: () => events.push("dispose") };

    assert.equal(columnDom.dispose_and_remove(column, lifecycle), true);
    assert.deepEqual(events, ["dispose", "remove"]);
    assert.equal(columnDom.dispose_and_remove(null, lifecycle), false);
});

test("iframe load monitoring removes listeners without rewriting a navigating src", () => {
    const columnDom = loadColumnDom();
    const frame = new FrameFixture();
    const scheduled = [];
    const cleanup = columnDom.watch_load_column([frame], 2, (callback, delay) => {
        scheduled.push({ callback, delay });
    });

    assert.equal(frame.listeners.get("load").length, 1);
    frame.dispatch("load");
    assert.equal(frame.src, "https://x.com/home");
    assert.equal(scheduled[0].delay, 2000);

    cleanup();
    assert.equal(frame.listeners.get("load").length, 0);
    scheduled[0].callback();
    assert.equal(frame.listeners.get("load").length, 0);
});
