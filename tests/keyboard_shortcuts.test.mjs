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
    vm.runInContext(readFileSync("extensions/custom/navigation_policy.js", "utf8"), context);
    vm.runInContext(readFileSync("extensions/custom/keyboard_shortcuts.js", "utf8"), context);
    return context.window.opd_custom_keyboard;
}

function dispatch_key(keyboard, iframe, { key = "Backspace", target = { tagName: "DIV", isContentEditable: false }, dialog = null } = {}) {
    const event = {
        key,
        target,
        prevented: false,
        stopped: false,
        preventDefault() {
            this.prevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        },
    };
    const deck = { getElementById: (id) => id === "opd_media_viewer" ? dialog : null };
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

function dispatch_backspace(keyboard, iframe, target) {
    return dispatch_key(keyboard, iframe, { target });
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

test("Backspace stays available while typing in editable controls", () => {
    for (const target of [
        { tagName: "DIV", isContentEditable: true },
        { tagName: "INPUT", isContentEditable: false },
        { tagName: "TEXTAREA", isContentEditable: false },
    ]) {
        let back_calls = 0;
        const keyboard = loadKeyboard({
            is_media_route: () => false,
            back() { back_calls += 1; },
        });
        const event = dispatch_backspace(keyboard, { id: "col-1" }, target);
        assert.equal(event.prevented, false, target.tagName);
        assert.equal(event.stopped, false, target.tagName);
        assert.equal(back_calls, 0, target.tagName);
    }
});

test("open viewer handles Escape and arrow keys without clicking disabled buttons", () => {
    const keyboard = loadKeyboard({ back() { assert.fail("viewer key must not navigate a column"); } });
    const clicks = [];
    let closes = 0;
    const buttons = {
        "[data-media-forward]": { disabled: false, click() { clicks.push("forward"); } },
        "[data-media-next]": { disabled: false, click() { clicks.push("next"); } },
    };
    const dialog = {
        open: true,
        close() { closes += 1; },
        querySelector(selector) { return buttons[selector] ?? null; },
    };
    for (const [key, expected] of [["ArrowLeft", "forward"], ["ArrowRight", "next"]]) {
        const event = dispatch_key(keyboard, null, { key, dialog });
        assert.equal(clicks.at(-1), expected);
        assert.equal(event.prevented, true);
        assert.equal(event.stopped, true);
    }
    buttons["[data-media-next]"].disabled = true;
    const before = clicks.length;
    const disabledEvent = dispatch_key(keyboard, null, { key: "ArrowRight", dialog });
    assert.equal(clicks.length, before);
    assert.equal(disabledEvent.prevented, true);
    const escapeEvent = dispatch_key(keyboard, null, { key: "Escape", dialog });
    assert.equal(closes, 1);
    assert.equal(escapeEvent.prevented, true);
});
