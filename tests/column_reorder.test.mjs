import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

//並び替えは flex の order だけを書き換え、iframeを持つ section をDOMから動かさない。
//DOMを動かすとブラウザーによってはiframeが再読み込みされ、カラムの表示が巻き戻る。
class Section {
    constructor(doc, type, id) {
        this.tagName = "SECTION";
        this.ownerDocument = doc;
        this.id = id;
        this.type = type;
        this.style = { order: "" };
        this.parentElement = null;
        //カラム本体。opd_column_type を持つのはこの要素だけ
        this.column = {
            getAttribute: (name) => (name === "opd_column_type" ? type : null),
            section: this,
        };
        this.children = [this.column];
    }

    getAttribute(name) {
        //空カラムは並び替えの対象にしない
        return name === "draggable" ? (this.type === "empty_column" ? "false" : "true") : null;
    }

    querySelector(selector) {
        return selector === 'div[opd_column_type="home"]' && this.type === "home" ? this.column : null;
    }
}

class Rack {
    constructor(id) {
        this.id = id;
        this.children = [];
    }

    append(section) {
        section.parentElement = this;
        this.children.push(section);
        return section;
    }
}

function createDeck(firstRackTypes, secondRackTypes = []) {
    const events = [];
    const racks = { "#first_rack_element": new Rack("first"), "#second_rack_element": new Rack("second") };
    const doc = {
        querySelector: (selector) => racks[selector] ?? null,
        querySelectorAll: () => sections.map((section) => section.column),
        dispatchEvent: (event) => events.push(event.type),
    };
    let nextId = 0;
    const sections = [
        ...firstRackTypes.map((type) => racks["#first_rack_element"].append(new Section(doc, type, `s${++nextId}`))),
        ...secondRackTypes.map((type) => racks["#second_rack_element"].append(new Section(doc, type, `s${++nextId}`))),
    ];
    return { doc, sections, events, racks };
}

function loadReorder(state_api) {
    const context = {
        window: state_api == null ? {} : { opd_custom_column_state: state_api },
        CustomEvent: class {
            constructor(type) {
                this.type = type;
            }
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/column_reorder.js", "utf8"), context);
    return context.window.opd_custom_column_reorder;
}

const orderOf = (sections) => sections.map((section) => section.style.order);

test("moving a column rewrites the flex order instead of the DOM", () => {
    const reorder = loadReorder();
    const { doc, sections, racks } = createDeck(["home", "notification", "home", "empty_column"]);
    const domBefore = racks["#first_rack_element"].children.slice();

    assert.equal(reorder.move_to(sections[2], 0), true);
    //DOM上の並びは変わらない
    assert.deepEqual(racks["#first_rack_element"].children, domBefore);
    assert.deepEqual(orderOf(sections), ["1", "2", "0", "3"]);
    //表示順で読むと、動かしたカラムが先頭に来ている
    assert.deepEqual(
        Array.from(reorder.get_visual_column_elements(doc), (column) => column.section.id),
        ["s3", "s1", "s2", "s4"]
    );
});

test("a move reports the new visual order to the save boundary", () => {
    const reorder = loadReorder();
    const { sections, events } = createDeck(["home", "home", "empty_column"]);

    assert.equal(reorder.move_to(sections[0], 1), true);
    assert.deepEqual(events, ["opd_custom_column_reordered"]);
    //範囲外・移動なしは保存を起こさない
    assert.equal(reorder.move_to(sections[0], 1), false);
    assert.equal(reorder.move_to(sections[0], 5), false);
    assert.equal(reorder.move_to(sections[0], -1), false);
    assert.deepEqual(events, ["opd_custom_column_reordered"]);
});

test("a cross-rack drop is handed back to the native drop handler", () => {
    const reorder = loadReorder();
    const { sections } = createDeck(["home", "empty_column"], ["home", "second_empty_column"]);

    //段をまたぐ移動は order では表現できないため false を返し、本家のDOM移動に任せる
    assert.equal(reorder.move_before(sections[0], sections[2]), false);
    assert.deepEqual(orderOf(sections), ["", "", "", ""]);
    //同じ段なら order だけで入れ替える
    assert.equal(reorder.move_before(sections[1], sections[0]), true);
    assert.deepEqual(orderOf(sections.slice(0, 2)), ["1", "0"]);
    assert.equal(reorder.move_before(sections[0], sections[0]), false);
    assert.equal(reorder.move_before(null, sections[0]), false);
});

test("a move by position remaps the tab state while keys are positions", () => {
    let tabs = { "0:0": "Following", "0:1": "List", "1:0": "Other" };
    const reorder = loadReorder({
        get_profile_index: (callback) => callback(0),
        is_stable_id_mode: () => false,
        update_all: (mutator) => { tabs = mutator(tabs); },
    });
    const { sections } = createDeck(["home", "home", "empty_column"]);

    reorder.move_to(sections[1], 0);
    //位置が鍵なので、付け替えないと別カラムのタブを奪う。他のプロファイルには触れない
    assert.deepEqual(JSON.parse(JSON.stringify(tabs)), {
        "0:0": "List",
        "0:1": "Following",
        "1:0": "Other",
    });
});

test("a move leaves the tab state alone once keys are stable ids", () => {
    let writes = 0;
    const reorder = loadReorder({
        get_profile_index: (callback) => callback(0),
        is_stable_id_mode: () => true,
        update_all: () => { writes += 1; },
    });
    const { sections } = createDeck(["home", "home", "empty_column"]);

    reorder.move_to(sections[1], 0);
    //安定IDは位置が変わっても同じカラムを指す。付け替えると逆に別カラムの保存を奪う
    assert.equal(writes, 0);
});
