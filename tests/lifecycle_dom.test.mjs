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
    }

    querySelectorAll() {
        return [];
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
