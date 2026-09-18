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

test("column width presets round-trip between rem values and select indexes", () => {
    const settings = loadColumnSettings();
    assert.deepEqual(Array.from(settings.WIDTH_PRESETS), [15, 20, 30]);

    // 初期表示・手入力後: 幅 -> select 値(属性文字列でも数値でも同じ)
    assert.deepEqual(["15", "20", "30"].map(settings.width_preset_index), [0, 1, 2]);
    assert.deepEqual([15, 20, 30].map(settings.width_preset_index), [0, 1, 2]);
    assert.deepEqual([null, "", "25", 42, "abc"].map(settings.width_preset_index), [3, 3, 3, 3, 3]);

    // select 変更: select 値 -> 幅。カスタム(3)と不正値は 30 に寄せる
    assert.deepEqual(["0", "1", "2"].map(settings.width_from_preset), [15, 20, 30]);
    assert.deepEqual(["3", 3, "9", null, undefined, "x"].map(settings.width_from_preset), [30, 30, 30, 30, 30, 30]);

    for (const [index, width] of settings.WIDTH_PRESETS.entries()) {
        assert.equal(settings.width_preset_index(settings.width_from_preset(String(index))), index);
        assert.equal(settings.width_from_preset(settings.width_preset_index(String(width))), width);
    }
});

test("default profile matches the former hand-written settings_init array", () => {
    const context = { window: {}, URL };
    vm.createContext(context);
    for (const file of ["extensions/custom/safe_values.js", "extensions/custom/column_settings.js", "extensions/custom/settings_codec.js"]) {
        vm.runInContext(readFileSync(file, "utf8"), context);
    }
    const settings = context.window.opd_custom_column_settings;
    const codec = context.window.opd_custom_settings_codec;

    // content.js settings_init に手書きされていた配列(exp_type は未使用のため落とす)
    const expected = [
        {type:"main_bar_empty_column", banner:false, top_visible:true, tw_view_mode:"0", column_save_path:"", column_save_title:"", column_pinned_path:"", auto_reload:false, auto_reload_time:10000, column_width:null},
        {type:"home", banner:true, top_visible:true, tw_view_mode:"0", column_save_path:"", column_save_title:"", column_pinned_path:"", auto_reload:false, auto_reload_time:10000, column_width:null},
        {type:"notification", banner:false, top_visible:true, tw_view_mode:"0", column_save_path:"", auto_reload:false, auto_reload_time:10000, column_pinned_path:"", column_save_title:"", column_width:null},
        {type:"explore", banner:false, top_visible:true, tw_view_mode:"0", column_save_path:"/explore", column_save_title:"", column_pinned_path:"", auto_reload:false, auto_reload_time:10000, column_width:null},
        {type:"empty_column", banner:false, top_visible:true, tw_view_mode:"0", column_save_path:"", column_save_title:"", column_pinned_path:"", auto_reload:false, auto_reload_time:10000, column_width:null},
    ];

    const actual = settings.default_profile();
    assert.equal(actual.length, expected.length);
    for (const [index, column] of expected.entries()) {
        assert.deepEqual(Object.keys(actual[index]).sort(), Object.keys(column).sort(), `column ${index} keys`);
        for (const [key, value] of Object.entries(column)) {
            assert.strictEqual(actual[index][key], value, `column ${index} (${column.type}) key ${key}`);
        }
    }
    assert.notEqual(settings.default_profile()[1], actual[1], "each call builds fresh objects");
    assert.equal(codec.validate_profile_store([{ name: "default", profile: settings.default_profile() }]), true);
});

test("profile summary picks one i18n line per visible column and numbers each row", () => {
    const settings = loadColumnSettings();
    const i18n = (key, substitutions) => substitutions == null ? key : `${key}(${substitutions.join(",")})`;

    const summary = settings.profile_summary([
        { type: "dsp_column" },
        { type: "main_bar_empty_column" },
        { type: "post" },
        { type: "home" },
        { type: "notification" },
        { type: "explore", column_save_title: "List 42" },
        { type: "empty_column" },
        { type: "misskey" },
        { type: "bsky" },
        { type: "home" },
        { type: "second_empty_column" },
    ], i18n);

    assert.deepEqual(Array.from(summary), [
        "msg_profile_desc_post_column(1)",
        "msg_profile_desc_timeline_column(2)",
        "msg_profile_desc_notification_column(3)",
        "msg_profile_desc_explore_column(4,List 42)",
        "msg_profile_desc_first_row_end",
        "msg_profile_desc_timeline_column(1)",
        "msg_profile_desc_second_row_end",
    ]);
    assert.deepEqual(Array.from(settings.profile_summary([], i18n)), []);
    assert.deepEqual(Array.from(settings.profile_summary(undefined, i18n)), []);
});
