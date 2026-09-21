import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class ColumnDomFixture {
    constructor(children = []) {
        this.tagName = "SECTION";
        this.children = children;
    }

    querySelectorAll(selector) {
        if (selector !== "iframe") {
            return [];
        }
        return this.children.flatMap((child) => [
            child,
            ...(child.children ?? []),
        ]);
    }
}

class IframeDomFixture {
    constructor(id) {
        this.tagName = "IFRAME";
        this.id = id;
        this.listeners = new Map();
    }

    querySelectorAll() {
        return [];
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

    listenerCount(name) {
        return (this.listeners.get(name) ?? []).length;
    }
}

//content.js の append_object_css と同じ形で、iframe単位の load リスナーを lifecycle に登録する
function attachFrameLoadListeners(lifecycle, frame) {
    for (const key of ["frame-css", "frame-init", "explore-url"]) {
        const listener = () => {};
        frame.addEventListener("load", listener);
        lifecycle.register_column_resource(frame, key, () => frame.removeEventListener("load", listener));
    }
}

//manifest の content_scripts と同じ順で、分割した3責務とその合成点を読み込む
const LIFECYCLE_SOURCES = [
    "extensions/custom/column_resource_registry.js",
    "extensions/custom/page_event_lifecycle.js",
    "extensions/custom/page_observer_lifecycle.js",
    "extensions/custom/lifecycle.js",
];

function loadLifecycle() {
    const context = { window: {} };
    vm.createContext(context);
    for (const source of LIFECYCLE_SOURCES) {
        vm.runInContext(readFileSync(source, "utf8"), context);
    }
    return context.window.opd_custom_lifecycle;
}

test("rebuilding a column disposes direct and nested iframe resources", () => {
    const lifecycle = loadLifecycle();
    const disposed = [];
    const frame = new IframeDomFixture("main");
    const nested_frame = new IframeDomFixture("nested");
    frame.children = [nested_frame];
    frame.opd_dispose_auto_reload = () => disposed.push("auto:main");
    nested_frame.opd_dispose_auto_reload = () => disposed.push("auto:nested");
    lifecycle.register_column_resource(frame, "history", () => disposed.push("history:main"));
    lifecycle.register_column_resource(nested_frame, "history", () => disposed.push("history:nested"));

    lifecycle.dispose_column_resources_in(new ColumnDomFixture([frame]));

    assert.deepEqual(disposed.sort(), [
        "auto:main", "auto:nested", "history:main", "history:nested",
    ]);
});

test("add, remove and add again never stacks load listeners on the remaining iframes", () => {
    const lifecycle = loadLifecycle();
    const rack = new ColumnDomFixture([]);
    const first = new IframeDomFixture("first");
    const second = new IframeDomFixture("second");

    //追加: 新しいiframeだけを初期化する
    rack.children.push(first, second);
    attachFrameLoadListeners(lifecycle, first);
    attachFrameLoadListeners(lifecycle, second);
    assert.equal(first.listenerCount("load"), 3);
    assert.equal(second.listenerCount("load"), 3);

    //削除: 消したiframeのリスナーだけが外れ、残ったiframeには触れない
    lifecycle.dispose_column_resources_in(second);
    rack.children.splice(rack.children.indexOf(second), 1);
    assert.equal(second.listenerCount("load"), 0);
    assert.equal(first.listenerCount("load"), 3);

    //再追加: 新しいiframeにだけ付き、既存のiframeは増えない
    const third = new IframeDomFixture("third");
    rack.children.push(third);
    attachFrameLoadListeners(lifecycle, third);
    assert.equal(first.listenerCount("load"), 3);
    assert.equal(third.listenerCount("load"), 3);

    //同じiframeを誤って再初期化しても、同じキーの再登録は前のリスナーを外して置き換える
    attachFrameLoadListeners(lifecycle, first);
    assert.equal(first.listenerCount("load"), 3);

    //デッキ再構築で全iframeのリスナーが外れる
    lifecycle.dispose_column_resources_in(rack);
    assert.equal(first.listenerCount("load"), 0);
    assert.equal(third.listenerCount("load"), 0);
});

test("a new iframe after rebuild receives an independent resource registry", () => {
    const lifecycle = loadLifecycle();
    const disposed = [];
    const old_frame = new IframeDomFixture("old");
    lifecycle.register_column_resource(old_frame, "column-back", () => disposed.push("old"));
    lifecycle.dispose_column_resources_in(old_frame);

    const new_frame = new IframeDomFixture("new");
    lifecycle.register_column_resource(new_frame, "column-back", () => disposed.push("new"));
    lifecycle.dispose_column_resources_in(new_frame);

    assert.deepEqual(disposed, ["old", "new"]);
});

class MutationObserverFixture {
    static instances = [];

    constructor(callback) {
        this.callback = callback;
        this.target = null;
        this.disconnected = false;
        MutationObserverFixture.instances.push(this);
    }

    observe(target) {
        this.target = target;
    }

    disconnect() {
        this.disconnected = true;
    }

    fire() {
        this.callback([]);
    }
}

function loadObserverLifecycle() {
    MutationObserverFixture.instances = [];
    const context = { window: {}, MutationObserver: MutationObserverFixture };
    vm.createContext(context);
    vm.runInContext(
        readFileSync("extensions/custom/page_observer_lifecycle.js", "utf8"),
        context
    );
    return context.window.opd_custom_page_observer_lifecycle;
}

test("observe_when_ready returns a disposer whether the target exists or appears later", () => {
    const observers = loadObserverLifecycle();
    const target = { id: "root" };
    const seen = [];

    //即座に見つかる場合: 初回コールバックのあと監視observerを止められる
    const dispose_ready = observers.observe_when_ready(() => target, null, (found) => seen.push(found.id), {});
    assert.deepEqual(seen, ["root"]);
    dispose_ready();
    assert.deepEqual(MutationObserverFixture.instances.map((item) => item.disconnected), [true]);

    //待機する場合: 待機observerと切り替え後のobserverの両方が止まる
    let late_target = null;
    const watch_root = { id: "watch" };
    const dispose_waiting = observers.observe_when_ready(
        () => late_target, watch_root, (found) => seen.push(found.id), {}
    );
    const wait_observer = MutationObserverFixture.instances.at(-1);
    assert.equal(wait_observer.target, watch_root);
    late_target = { id: "late" };
    wait_observer.fire();
    assert.deepEqual(seen, ["root", "late"]);
    dispose_waiting();
    assert.ok(MutationObserverFixture.instances.every((item) => item.disconnected));
});

test("observe_when_ready without a watch root disposes without throwing", () => {
    const observers = loadObserverLifecycle();
    const dispose = observers.observe_when_ready(() => null, null, () => {}, {});
    dispose();
    assert.equal(MutationObserverFixture.instances.length, 0);
});

test("page observers are attached once and their disposer stops every observer", () => {
    const observers = loadObserverLifecycle();
    const react_root = { id: "react" };
    const head = { id: "head" };
    const changes = [];
    const options = {
        get_react_root: () => react_root,
        react_watch_root: null,
        on_react_change: (target) => changes.push(`react:${target.id}`),
        react_observer_options: {},
        get_head: () => head,
        head_watch_root: null,
        on_head_change: (target) => changes.push(`head:${target.id}`),
        head_observer_options: {},
    };

    const dispose = observers.initialize_page_observers(options);
    assert.deepEqual(changes, ["react:react", "head:head"]);
    assert.equal(MutationObserverFixture.instances.length, 2);

    //2度目はコールバックを流し直すだけでobserverは増やさない
    assert.equal(observers.initialize_page_observers(options), dispose);
    assert.deepEqual(changes, ["react:react", "head:head", "react:react", "head:head"]);
    assert.equal(MutationObserverFixture.instances.length, 2);

    dispose();
    assert.ok(MutationObserverFixture.instances.every((item) => item.disconnected));
});
