import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadKeyboard(history) {
    const context = {
        window: {
            opd_custom_column_history: history,
        },
        WeakSet,
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/keyboard_shortcuts.js", "utf8"), context);
    return context.window.opd_custom_keyboard;
}

function dispatch_backspace(keyboard, iframe) {
    const event = {
        key: "Backspace",
        target: { tagName: "DIV", isContentEditable: false },
        prevented: false,
        stopped: false,
        preventDefault() {
            this.prevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        },
    };
    const deck = { getElementById: () => null };
    const doc = {
        addEventListener(type, handler) {
            if (type === "keydown") {
                handler(event);
            }
        },
    };
    keyboard.attach(doc, deck, iframe);
    return event;
}

test("Backspace is swallowed even when the column cannot go back", () => {
    const back_calls = [];
    const keyboard = loadKeyboard({
        is_media_route: () => false,
        back(iframe) {
            back_calls.push(iframe);
            return false;
        },
    });
    const iframe = { id: "col-1" };
    const event = dispatch_backspace(keyboard, iframe);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(back_calls.length, 1);
});

test("Backspace on a media route is left to X", () => {
    let back_calls = 0;
    const keyboard = loadKeyboard({
        is_media_route: () => true,
        back() {
            back_calls += 1;
            return true;
        },
    });
    const event = dispatch_backspace(keyboard, { id: "col-1" });
    assert.equal(event.prevented, false);
    assert.equal(back_calls, 0);
});
