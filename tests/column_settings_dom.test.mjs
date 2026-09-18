import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class ColumnDomFixture {
    constructor(type, attributes = {}, controls = {}) {
        this.attributes = { opd_column_type: type, ...attributes };
        this.controls = controls;
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    querySelector(selector) {
        return this.controls[selector] ?? null;
    }
}

function loadColumnSettings() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(
        readFileSync("extensions/custom/safe_values.js", "utf8"),
        context
    );
    vm.runInContext(
        readFileSync("extensions/custom/column_settings.js", "utf8"),
        context
    );
    return context.window.opd_custom_column_settings;
}

test("column settings reads all supported column DOM variants", () => {
    const settings = loadColumnSettings();
    const fixtures = [
        new ColumnDomFixture("post", { opd_column_width: "31" }),
        new ColumnDomFixture("home", { opd_column_width: "32" }, {
            ".opd_banner": { checked: true },
            ".opd_top_bar": { checked: true },
            ".opd_tw_view_mode": { value: "1" },
            ".opd_a_reload_bar": { checked: true },
            ".opd_a_reload_time_setting": { value: "15" },
        }),
        new ColumnDomFixture("notification", { opd_column_width: "33" }, {
            ".opd_tw_view_mode": { value: "2" },
        }),
        new ColumnDomFixture("explore", {
            opd_column_width: "34",
            opd_explore_path: "/i/lists/42",
            opd_explore_title: "List 42",
            opd_pinned_path: "/i/lists/99",
        }, {
            ".opd_a_reload_time_setting": { value: "0" },
        }),
    ];

    const actual = Array.from(fixtures, (fixture) => settings.read(fixture));
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), [
        {
            type: "post", banner: false, top_visible: false, tw_view_mode: "0",
            column_save_path: "", column_save_title: "", column_pinned_path: "",
            auto_reload: null, auto_reload_time: 10000, column_width: "31",
        },
        {
            type: "home", banner: true, top_visible: true, tw_view_mode: "1",
            column_save_path: "", column_save_title: "", column_pinned_path: "",
            auto_reload: true, auto_reload_time: 15000, column_width: "32",
        },
        {
            type: "notification", banner: false, top_visible: false, tw_view_mode: "2",
            column_save_path: "", column_save_title: "", column_pinned_path: "",
            auto_reload: null, auto_reload_time: 10000, column_width: "33",
        },
        {
            type: "explore", banner: false, top_visible: false, tw_view_mode: "0",
            column_save_path: "/i/lists/42", column_save_title: "List 42",
            column_pinned_path: "/i/lists/99", auto_reload: false,
            auto_reload_time: 10000, column_width: "34",
        },
    ]);
});

test("new column values keep the four add-column defaults in one boundary", () => {
    const settings = loadColumnSettings();
    const values = ["post", "home", "notification", "explore"].map((type) =>
        settings.new_column_values(type, `${type}-id`)
    );

    assert.deepEqual(values.map((item) => item["%column_num%"]), [
        "post-id", "home-id", "notification-id", "explore-id",
    ]);
    assert.deepEqual(values.map((item) => item["%column_top_bar_ch%"]), [
        "checked", "checked", "checked", "checked",
    ]);
    assert.deepEqual(values.map((item) => item["%column_save_path%"]), [
        "", "", "", "/explore",
    ]);
    assert.deepEqual(values.map((item) => item["%column_width_num%"]), [
        "30", "30", "30", "30",
    ]);
});

test("normalization and rendering form a safe settings round trip", () => {
    const settings = loadColumnSettings();
    const normalized = settings.normalize({
        type: "explore",
        tw_view_mode: "unexpected",
        column_save_path: "/explore?q=ok",
        column_pinned_path: "/i/lists/7",
        column_save_title: "<List>",
        auto_reload_time: 500,
        column_width: 42,
    });

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        type: "explore",
        banner: false,
        top_visible: false,
        tw_view_mode: "0",
        column_save_path: "/explore?q=ok",
        column_save_title: "<List>",
        column_pinned_path: "/i/lists/7",
        auto_reload: false,
        auto_reload_time: 10000,
        column_width: "42",
    });
    assert.equal(
        settings.render("<div data-path=\"%column_save_path%\">%column_save_title%</div>", normalized, "col-1"),
        "<div data-path=\"/i/lists/7\">&lt;List&gt;</div>"
    );
});

test("profile rendering splits racks and preserves inherited column width", () => {
    const settings = loadColumnSettings();
    let nextId = 0;
    const rendered = settings.render_profile([
        { type: "home", column_width: "32" },
        { type: "empty_column", column_width: null },
        { type: "explore", column_save_path: "/i/lists/42", column_width: null },
        { type: "second_empty_column", column_width: null },
        { type: "unsupported", column_width: "99" },
    ], {
        home: { html: "<home id='%column_num%' width='%column_width_num%'></home>" },
        empty_column: { html: "<empty id='%column_num%' width='%column_width_num%'></empty>" },
        explore: { html: "<explore id='%column_num%' width='%column_width_num%' path='%column_save_path%'></explore>" },
        second_empty_column: { html: "<second-empty id='%column_num%' width='%column_width_num%'></second-empty>" },
    }, () => `column-${++nextId}`);

    assert.equal(
        rendered.first_rack_html,
        "<home id='column-1' width='32'></home><empty id='column-2' width='32'></empty>"
    );
    assert.equal(
        rendered.second_rack_html,
        "<explore id='column-3' width='32' path='/i/lists/42'></explore>"
            + "<second-empty id='column-4' width='32'></second-empty>"
    );
    assert.equal(rendered.first_rack_ended, true);
    assert.equal(rendered.second_rack_ended, true);
});

test("profile reading follows visual order for save and rebuild round trips", () => {
    const settings = loadColumnSettings();
    const home = new ColumnDomFixture("home", { opd_column_width: "32" }, {
        ".opd_banner": { checked: true },
        ".opd_top_bar": { checked: true },
        ".opd_tw_view_mode": { value: "1" },
        ".opd_a_reload_bar": { checked: true },
        ".opd_a_reload_time_setting": { value: "15" },
    });
    const explore = new ColumnDomFixture("explore", {
        opd_column_width: "34",
        opd_explore_path: "/i/lists/42",
        opd_explore_title: "List 42",
        opd_pinned_path: "",
    }, {
        ".opd_a_reload_bar": { checked: false },
        ".opd_a_reload_time_setting": { value: "10" },
    });
    const sidebar = new ColumnDomFixture("dsp_column");
    const document = {
        querySelectorAll: () => [home, explore],
    };
    const reorder = {
        get_visual_column_elements: (receivedDocument) => {
            assert.equal(receivedDocument, document);
            return [sidebar, explore, home];
        },
    };

    const saved = settings.read_profile(document, reorder);
    assert.deepEqual(saved.map((item) => item.type), ["explore", "home"]);

    let nextId = 0;
    const rebuilt = settings.render_profile(saved, {
        explore: { html: "<column type='explore' id='%column_num%' path='%column_save_path%'></column>" },
        home: { html: "<column type='home' id='%column_num%' mode='%column_tw_view_mode%'></column>" },
    }, () => `rebuilt-${++nextId}`);
    assert.equal(
        rebuilt.first_rack_html,
        "<column type='explore' id='rebuilt-1' path='/i/lists/42'></column>"
            + "<column type='home' id='rebuilt-2' mode='1'></column>"
    );
});
