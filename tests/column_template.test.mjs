import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadColumnTemplate() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/column_template.js", "utf8"), context);
    return context.window.opd_custom_column_template;
}

const t = (key) => `[${key}]`;
const url = (path) => `ext://${path}`;
const icons = { column_add_1: "icon/column_add_1st.svg", column_add_2: "icon/column_add_2nd.svg" };
const COLUMN_TYPES = ["post", "home", "notification", "explore"];

function count(html, pattern) {
    return html.split(pattern).length - 1;
}

test("build は content.js が参照する全種別を元の並び順で返す", () => {
    const built = loadColumnTemplate().build(t, url, icons);
    assert.deepEqual(Object.keys(built), ["empty_column", "post", "second_empty_column", "home", "notification", "explore"]);
    for (const item of Object.values(built)) {
        assert.equal(typeof item.html, "string");
        assert.match(item.html, /^<section [^>]*id="column_%column_num%"/);
        assert.match(item.html, /<\/section>$/);
    }
    assert.match(built.empty_column.html, /opd_column_type="empty_column"[\s\S]*src="ext:\/\/icon\/column_add_1st\.svg"[\s\S]*\[ui_empty_column_message\]/);
    assert.match(built.second_empty_column.html, /opd_column_type="second_empty_column"[\s\S]*src="ext:\/\/icon\/column_add_2nd\.svg"[\s\S]*\[ui_second_empty_column_message\]/);
});

test("4カラムは共通の骨格を持ち、種別と表題だけが入れ替わる", () => {
    const template = loadColumnTemplate();
    const titles = {
        post: "ui_column_post_title",
        home: "ui_column_timeline_title",
        notification: "ui_column_notifications_title",
        explore: "ui_column_explore_title",
    };
    for (const type of COLUMN_TYPES) {
        const html = template.column_html(t, type);
        assert.match(html, new RegExp(`^<section draggable="true" id="column_%column_num%" class="dsp_column_draggable_true dsp_column"><div opd_column_type="${type}" opd_column_width="%column_width_num%"`));
        assert.ok(html.includes(`<span>[${titles[type]}]</span>`), type);
        assert.equal(count(html, `class="dsp_column_settings_panel"`), 1, type);
        assert.equal(count(html, `class="column_close_btn"`), 1, type);
        assert.equal(count(html, `class="opd_settings_btn"`), 1, type);
        assert.equal(count(html, "<iframe "), 1, type);
        assert.match(html, /<iframe [^>]*allow="fullscreen"[^>]*opd_init_webview><\/iframe><\/div><\/section>$/);
    }
});

test("種別ごとのバー構成・設定項目・iframe属性の差を固定する", () => {
    const template = loadColumnTemplate();
    const expected = {
        post: { reload: 0, banner: 0, top: 0, pin: 0, auto_reload: 0, hover: 1, src: "https://x.com/intent/tweet" },
        home: { reload: 1, banner: 1, top: 1, pin: 0, auto_reload: 1, hover: 1, src: "https://x.com/home" },
        notification: { reload: 1, banner: 1, top: 1, pin: 0, auto_reload: 0, hover: 0, src: "https://x.com/notifications" },
        explore: { reload: 1, banner: 1, top: 1, pin: 1, auto_reload: 1, hover: 1, src: "https://x.com%column_save_path%" },
    };
    for (const type of COLUMN_TYPES) {
        const html = template.column_html(t, type);
        const want = expected[type];
        const actual = {
            reload: count(html, `class="opd_column_reload_btn"`),
            banner: count(html, `class="opd_banner"`),
            top: count(html, `class="opd_top_bar"`),
            pin: count(html, `class="opd_pinned_btn"`),
            auto_reload: count(html, `class="opd_a_reload_bar"`),
            hover: count(html, `auto_reload_mouse_hover="false"`),
            src: html.match(/<iframe [^>]*src="([^"]+)"/)[1],
        };
        assert.deepEqual(actual, want, type);
        assert.equal(count(html, "opd_a_reload_time_setting"), want.auto_reload, type);
        assert.equal(count(html, "%column_auto_reload_ch%"), want.auto_reload, type);
        assert.equal(count(html, "%column_auto_reload_time%"), want.auto_reload, type);
    }
    //探索カラムだけが保存パスとピン留めの置換子を持つ。
    const explore = template.column_html(t, "explore");
    assert.match(explore, /opd_explore_path="%column_save_path%" opd_explore_title="%column_save_title%" opd_pinned_path="%column_pinned_save_path%"/);
    assert.ok(explore.includes("%column_pinned_ch%"));
    for (const type of ["post", "home", "notification"]) {
        assert.doesNotMatch(template.column_html(t, type), /%column_save_path%|%column_pinned_/, type);
    }
});

test("設定パネルは自動更新の有無で2項目だけが増減する", () => {
    const template = loadColumnTemplate();
    const with_auto = template.settings_panel(t, true);
    const without_auto = template.settings_panel(t, false);
    assert.equal(count(with_auto, `class="dsp_column_settings_content_div"`), 5);
    assert.equal(count(without_auto, `class="dsp_column_settings_content_div"`), 3);
    for (const html of [with_auto, without_auto]) {
        assert.match(html, /<select class="opd_tw_view_mode" column_tw_view_mode_val="%column_tw_view_mode%"><option value="0">\[ui_settings_view_mode_all\]<\/option><option value="1">\[ui_settings_view_mode_text_only\]<\/option><option value="2">\[ui_settings_view_mode_media_only\]<\/option><\/select>/);
        assert.equal(count(html, "<option "), 7);
        assert.equal(count(html, `class="column_width_btn"`), 1);
        assert.equal(count(html, `class="dsp_column_settings_panel_close_btn"`), 1);
    }
    //自動更新の2項目を除けば同じHTMLになる。
    const auto_rows = with_auto.match(/<div class="dsp_column_settings_content_div">\[ui_settings_auto_reload_label\][\s\S]*?\[ui_settings_seconds_suffix\]<\/span><\/div>/)[0];
    assert.equal(with_auto.replace(auto_rows, ""), without_auto);
});
