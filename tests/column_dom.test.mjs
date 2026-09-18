import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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

    const settings = {
        new_column_setting: (type) => ({ type, top_visible: true }),
        render: (template, setting, id) => `${template}:${setting.type}:${id}`,
    };
    target.parentElement = { children: [regularColumn, target] };
    const addDocument = { querySelector: () => target };
    assert.equal(
        columnDom.add_column(
            addDocument,
            "home",
            "<home></home>",
            settings,
            () => "column-1",
            reorder,
            false
        ),
        newColumn
    );
    assert.deepEqual(calls.slice(2), [
        ["beforebegin", "<home></home>:home:column-1"],
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
