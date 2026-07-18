import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadLifecycle(frames = []) {
    const listeners = { window: {}, document: {} };
    const context = {
        console: { warn: () => {} },
        window: {
            addEventListener: (name, callback) => {
                listeners.window[name] ??= [];
                listeners.window[name].push(callback);
            },
        },
        document: {
            addEventListener: (name, callback) => {
                listeners.document[name] ??= [];
                listeners.document[name].push(callback);
            },
            querySelectorAll: () => frames,
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/lifecycle.js", "utf8"), context);
    return { lifecycle: context.window.opd_custom_lifecycle, listeners };
}

test("lifecycle owns auto-reload disposal and media tokens", () => {
    const frame = {};
    const staleFrame = {};
    const { lifecycle } = loadLifecycle([frame]);
    const disposed = [];
    const disposeA = () => {
        disposed.push("A");
        lifecycle.untrack_auto_reload(disposeA);
    };
    const disposeB = () => {
        disposed.push("B");
        lifecycle.untrack_auto_reload(disposeB);
    };

    lifecycle.track_auto_reload(disposeA);
    lifecycle.track_auto_reload(disposeB);
    lifecycle.dispose_all_auto_reload();
    lifecycle.dispose_all_auto_reload();
    assert.deepEqual(disposed.sort(), ["A", "B"]);

    lifecycle.register_media_viewer_token(frame, "current");
    lifecycle.register_media_viewer_token(staleFrame, "stale");
    assert.equal(lifecycle.is_current_media_viewer_token("current", [frame]), true);
    assert.equal(lifecycle.is_current_media_viewer_token("stale", [frame]), false);
});

test("page event listeners are registered once and reject stale media events", () => {
    const frame = {};
    const { lifecycle, listeners } = loadLifecycle([frame]);
    const focusEvents = [];
    const mediaEvents = [];
    const options = {
        on_post_focus: (detail) => focusEvents.push(detail),
        on_media_info: (detail) => mediaEvents.push(detail),
    };

    lifecycle.register_media_viewer_token(frame, "current");
    lifecycle.initialize_page_event_listeners(options);
    lifecycle.initialize_page_event_listeners(options);
    assert.equal(listeners.window.opd_post_focus.length, 1);
    assert.equal(listeners.document.opd_send_media_info.length, 1);

    listeners.window.opd_post_focus[0]({ detail: "true" });
    listeners.window.opd_post_focus[0]({ detail: "not-json" });
    listeners.document.opd_send_media_info[0]({ detail: JSON.stringify({ token: "stale" }) });
    listeners.document.opd_send_media_info[0]({ detail: JSON.stringify({ token: "current", selected_index: 0 }) });

    assert.deepEqual(focusEvents, [true]);
    assert.equal(mediaEvents.length, 1);
    assert.equal(mediaEvents[0].token, "current");
});
