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

//Shift併用の追加は先頭カラムへ、通常の追加は空カラムへ入る。
//先頭カラムが無いとき(空カラムだけのラック)はShiftでも空カラムへ戻す必要がある。
test("the insertion target falls back to the empty column when the rack has no column yet", () => {
    const columnDom = loadColumnDom();
    //空カラムはsectionだがdraggableを持たないため、先頭カラムとしては拾われない
    const emptyColumn = { tagName: "SECTION", getAttribute: () => null };
    //ラック内に空カラムしか無い。並び替え用の draggable な section が無い状態
    emptyColumn.parentElement = { children: [emptyColumn] };
    const document = { querySelector: () => emptyColumn };

    assert.equal(columnDom.get_add_target(document, true), emptyColumn);
    assert.equal(columnDom.get_add_target(document, false), emptyColumn);

    //空カラム自体が見つからない文書では追加先を決められない
    assert.equal(columnDom.get_add_target({ querySelector: () => null }, true), null);
    assert.equal(columnDom.get_add_target(null, true), undefined);
    assert.equal(columnDom.add_column(null, "home", "<home></home>", {}, () => "column-1", null, true), null);
});

//draggable でない section (ドラッグ無効のカラム) は先頭として扱わない
test("the head insertion target skips nodes that are not reorderable columns", () => {
    const columnDom = loadColumnDom();
    const fixedColumn = {
        tagName: "SECTION",
        getAttribute: () => "false",
    };
    const divider = {
        tagName: "DIV",
        getAttribute: () => "true",
    };
    const regularColumn = {
        tagName: "SECTION",
        getAttribute: (name) => name === "draggable" ? "true" : null,
    };
    const emptyColumn = { tagName: "SECTION", getAttribute: () => null };
    emptyColumn.parentElement = { children: [divider, fixedColumn, regularColumn, emptyColumn] };
    const document = { querySelector: () => emptyColumn };

    assert.equal(columnDom.get_add_target(document, true), regularColumn);
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

//iframeの読み込み判定はここに1つだけ置く。生成直後の about:blank は complete でも
//Xの読み込みで捨てられるため、仕掛ける価値のある文書だけを true とする
test("frame readiness accepts only a loaded http document", () => {
    const columnDom = loadColumnDom();
    const frame = (contentDocument) => ({ contentDocument });

    assert.equal(columnDom.is_frame_loaded(frame({
        readyState: "complete",
        location: { href: "https://x.com/home" },
    })), true);
    assert.equal(columnDom.is_frame_loaded(frame({
        readyState: "loading",
        location: { href: "https://x.com/home" },
    })), false);
    //生成直後の about:blank
    assert.equal(columnDom.is_frame_loaded(frame({
        readyState: "complete",
        location: { href: "about:blank" },
    })), false);
    assert.equal(columnDom.is_frame_loaded(frame({ readyState: "complete", location: null })), false);
    assert.equal(columnDom.is_frame_loaded(frame(null)), false);
    assert.equal(columnDom.is_frame_loaded(null), false);
    //クロスオリジンでは contentDocument 参照自体が投げる
    assert.equal(columnDom.is_frame_loaded({
        get contentDocument() { throw new Error("cross origin"); },
    }), false);
});
