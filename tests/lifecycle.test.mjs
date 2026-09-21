import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

//manifest の content_scripts と同じ順で、分割した3責務とその合成点を読み込む
const LIFECYCLE_SOURCES = [
    "extensions/custom/column_resource_registry.js",
    "extensions/custom/page_event_lifecycle.js",
    "extensions/custom/page_observer_lifecycle.js",
    "extensions/custom/lifecycle.js",
];

function loadLifecycle(frames = []) {
    const listeners = { window: {}, document: {} };
    const remove = (target, name, callback) => {
        listeners[target][name] = (listeners[target][name] ?? []).filter((item) => item !== callback);
    };
    const context = {
        console: { warn: () => {} },
        window: {
            addEventListener: (name, callback) => {
                listeners.window[name] ??= [];
                listeners.window[name].push(callback);
            },
            removeEventListener: (name, callback) => remove("window", name, callback),
        },
        document: {
            addEventListener: (name, callback) => {
                listeners.document[name] ??= [];
                listeners.document[name].push(callback);
            },
            removeEventListener: (name, callback) => remove("document", name, callback),
            querySelectorAll: () => frames,
        },
    };
    context.window.window = context.window;
    context.window.document = context.document;
    vm.createContext(context);
    for (const source of LIFECYCLE_SOURCES) {
        vm.runInContext(readFileSync(source, "utf8"), context);
    }
    return { lifecycle: context.window.opd_custom_lifecycle, context, listeners };
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

test("column resources are replaced by key and disposed with their frame", () => {
    const frame = { tagName: "IFRAME", querySelectorAll: () => [] };
    const { lifecycle } = loadLifecycle();
    const disposed = [];
    lifecycle.register_column_resource(frame, "review", () => disposed.push("old"));
    lifecycle.register_column_resource(frame, "review", () => disposed.push("current"));
    lifecycle.register_column_resource(frame, "back", () => disposed.push("back"));
    assert.deepEqual(disposed, ["old"]);
    lifecycle.dispose_column_resources_in(frame);
    lifecycle.dispose_column_resources_in(frame);
    assert.deepEqual(disposed, ["old", "current", "back"]);
});

test("lifecycle splits into three modules and composes them", () => {
    const { context } = loadLifecycle();
    assert.equal(typeof context.window.opd_custom_column_resource_registry.register_column_resource, "function");
    assert.equal(typeof context.window.opd_custom_page_event_lifecycle.initialize, "function");
    assert.equal(typeof context.window.opd_custom_page_observer_lifecycle.initialize_page_observers, "function");
    //合成点は3モジュールの入口だけを公開し、状態を自分では持たない
    assert.equal(
        context.window.opd_custom_lifecycle.register_column_resource,
        context.window.opd_custom_column_resource_registry.register_column_resource
    );
});

test("page event listeners return a disposer that detaches both listeners", () => {
    const frame = {};
    const { lifecycle, listeners } = loadLifecycle([frame]);
    const focusEvents = [];
    const options = {
        on_post_focus: (detail) => focusEvents.push(detail),
        on_media_info: () => {},
    };

    const dispose = lifecycle.initialize_page_event_listeners(options);
    assert.equal(typeof dispose, "function");
    assert.equal(lifecycle.initialize_page_event_listeners(options), dispose, "2度目も同じdisposerを返す");

    dispose();
    assert.equal(listeners.window.opd_post_focus.length, 0);
    assert.equal(listeners.document.opd_send_media_info.length, 0);

    //破棄後はもう一度張り直せる
    lifecycle.initialize_page_event_listeners(options);
    assert.equal(listeners.window.opd_post_focus.length, 1);
    listeners.window.opd_post_focus[0]({ detail: "true" });
    assert.deepEqual(focusEvents, [true]);
});
