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

function loadLifecycle() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(
        readFileSync("extensions/custom/lifecycle.js", "utf8"),
        context
    );
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
