import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const content = readFileSync("content.js", "utf8");
const background = readFileSync("background.js", "utf8");
const textReview = readFileSync("extensions/text_review.js", "utf8");
const textReviewHelper = readFileSync("extensions/text_review_helper.js", "utf8");
const lifecycle = readFileSync("extensions/custom/lifecycle.js", "utf8");
const columnDom = readFileSync("extensions/custom/column_dom.js", "utf8");
const autoReloadHelper = readFileSync("extensions/auto_reload_helper.js", "utf8");
const mediaViewer = readFileSync("extensions/media_viewer/media_viewer.js", "utf8");
const settingsImport = readFileSync("extensions/custom/settings_import.js", "utf8");
const columnSettings = readFileSync("extensions/custom/column_settings.js", "utf8");
const columnFrameCss = readFileSync("extensions/custom/column_frame_css.js", "utf8");

test("new auto-reload columns use seconds in the UI", () => {
    assert.match(columnSettings, /"%column_auto_reload_time%"/);
    assert.match(columnSettings, /function new_column_setting\(type\)/);
    assert.match(content, /add_new_column\("home"\)/);
    assert.match(content, /add_new_column\("explore"\)/);
    assert.doesNotMatch(content, /replaceAll\("%column_auto_reload_time%"/);
});

test("auto reload controls stay in the handler scope and columns expose a manual refresh", () => {
    const start_index = content.indexOf("const start_auto_reload = function");
    const branch_index = content.indexOf("if(opd_column_auto_reload_checkbox != null){");
    assert.ok(start_index > 0 && branch_index > start_index);
    assert.match(content, /const reload_column_content = function/);
    assert.match(content, /opd_column_reload_btn\.addEventListener\("click"/);
    assert.match(content, /class="opd_column_reload_btn"/);
    assert.match(content, /column_reload:"icon\/column_reload\.svg"/);
});

test("auto reload helper re-resolves the timeline refresh function on every reload", () => {
    assert.match(autoReloadHelper, /function resolve_reload_func\(\)/);
    assert.match(autoReloadHelper, /const refresh = resolve_reload_func\(\) \?\? reload_func/);
});

test("auto reload helper keeps X from scrolling the timeline to the top", () => {
    // Delegating to the native scrollIntoView / focus lets X jump the timeline
    // back to the top while it restores a column after a back navigation.
    assert.match(autoReloadHelper, /if \(!parent\) return;/);
    assert.doesNotMatch(autoReloadHelper, /originalScrollIntoView/);
    assert.match(autoReloadHelper, /originalFocus\.call\(this, Object\.assign\(\{\}, options, \{ preventScroll: true \}\)\)/);
});

test("profile deletion validates a non-negative in-range integer", () => {
    assert.match(content, /if\(delete_input == null\)/);
    assert.match(content, /!\/\^\\d\+\$\/\.test\(normalized_delete_input\)/);
    assert.match(content, /delete_num >= profile_store\.length/);
});

test("page lifecycle and media tokens do not accumulate after rebuilds", () => {
    assert.match(lifecycle, /const auto_reload_disposers = new Set\(\)/);
    assert.match(lifecycle, /is_page_observer_initialized/);
    assert.match(lifecycle, /is_page_event_listener_initialized/);
    assert.match(lifecycle, /const media_viewer_tokens_by_frame = new WeakMap\(\)/);
    assert.match(content, /deck_lifecycle\.register_media_viewer_token\(column_frame,/);
    assert.match(content, /deck_lifecycle\.initialize_page_observers/);
    assert.match(content, /deck_lifecycle\.dispose_column_resources_in/);
    assert.match(lifecycle, /register_column_resource/);
    assert.match(columnDom, /function watch_load_column/);
    assert.match(content, /column_dom\.watch_load_column/);
    assert.match(content, /column_dom\.dispose_and_remove/);
    assert.doesNotMatch(content, /function observe_when_ready/);
    assert.doesNotMatch(content, /function set_title_favicon/);
    assert.doesNotMatch(content, /media_viewer_token\.push/);
});

test("settings and profiles use the shared storage repository", () => {
    assert.match(content, /const deck_storage = window\.opd_custom_storage/);
    assert.match(content, /deck_storage\.get_json_many/);
    assert.match(content, /deck_storage\.update_json/);
    assert.doesNotMatch(content, /chrome\.storage\.local/);
});

test("untrusted values cross explicit safe DOM and URL boundaries", () => {
    assert.match(columnSettings, /safe_values\.render_attribute_template/);
    assert.match(content, /column_settings\.render/);
    assert.doesNotMatch(mediaViewer, /src="\$\{/);
    assert.doesNotMatch(mediaViewer, /wrapper\.innerHTML/);
    assert.match(mediaViewer, /normalize_https_url/);
});

test("remaining audit hardening paths are wired", () => {
    assert.match(content, /start_auto_reload\(Number\(auto_reload_time\.value\) \* 1000\)/);
    assert.match(content, /const read_explore_state = function/);
    assert.match(settingsImport, /reader\.addEventListener\("error"/);
});

test("custom history intercepts the X back button and Backspace", () => {
    const customIndex = readFileSync("extensions/custom/index.js", "utf8");
    const keyboardShortcuts = readFileSync("extensions/custom/keyboard_shortcuts.js", "utf8");
    assert.match(customIndex, /column_history\.track\(iframe\)/);
    assert.match(customIndex, /function attach_column_back\(doc, iframe\)/);
    assert.match(customIndex, /app-bar-back/);
    assert.match(customIndex, /stopImmediatePropagation/);
    assert.match(keyboardShortcuts, /column_history\.back\(iframe\)/);
    // back() が false でも preventDefault し、ブラウザ戻るに落とさない
    assert.match(keyboardShortcuts, /window\.opd_custom_column_history\.back\(iframe\);\s*\n\s*handled = true;/);
});

test("top visibility keeps timeline tabs available", () => {
    assert.match(columnFrameCss, /function top_visible_css\(column_type, visible, legacy_mode = false\)/);
    assert.match(columnFrameCss, /:not\(:has\(\[role="tab"\]\)\)/);
    assert.ok((content.match(/column_frame_css\.top_visible_css\(/g) ?? []).length >= 3);
    assert.doesNotMatch(content, /function get_top_visible_css/);
    assert.doesNotMatch(columnFrameCss, />div:nth-child\(1\)\{visibility: hidden;/);
    assert.doesNotMatch(columnFrameCss, />div:nth-child\(1\)\{display:none;/);
});

test("post top visibility hides only the composer and keeps back navigation", () => {
    assert.match(columnFrameCss, /if\(column_type == "post"\)/);
    assert.match(columnFrameCss, /tweetTextarea_0/);
    assert.match(columnFrameCss, /tweetTextarea_0.*display:block !important/);
    assert.match(columnFrameCss, /app-bar-back.*display:block/);
    assert.match(textReviewHelper, /back_button\.style\.display = "block"/);
    assert.doesNotMatch(textReviewHelper, /back_button\.style\.display = "none"/);
});

test("iframe CSS is applied only through column_frame_css", () => {
    //CSS本文の複製が content.js に戻らないこと(R-11)
    assert.doesNotMatch(content, /header\[role="banner"\]\{/);
    assert.doesNotMatch(content, /cellInnerDiv"\]:has\(div\[aria-labelledby\]\)/);
    assert.doesNotMatch(content, /<style opd_(banner|top_visible|tw_view_mode|main)_css/);
    assert.doesNotMatch(content, /style\[opd_(banner|top_visible|tw_view_mode)_css\]/);
    assert.match(content, /const column_frame_css = window\.opd_custom_column_frame_css;/);
    for (const attr of ["opd_main_css", "opd_banner_css", "opd_top_visible_css", "opd_tw_view_mode_css"]) {
        assert.ok(content.includes(`column_frame_css.apply(frame_doc, "${attr}"`), `load path: ${attr}`);
    }
    //change リスナーは load をまたぐため、documentをイベント時に取り直す
    assert.match(content, /column_frame_css\.apply\(banner_mode_target_object\.contentWindow\.document, "opd_banner_css"/);
    assert.match(content, /column_frame_css\.apply\(topvisible_mode_target_object\.contentWindow\.document, "opd_top_visible_css"/);
    assert.match(content, /column_frame_css\.apply\(tw_view_mode_target_object\.contentWindow\.document, "opd_tw_view_mode_css"/);
});

test("column reorder preserves iframe documents and saves visual order", () => {
    const reorder = readFileSync("extensions/custom/column_reorder.js", "utf8");
    assert.match(reorder, /section\.style\.order/);
    assert.match(reorder, /get_visual_column_elements/);
    assert.match(content, /reorder_api\?\.move_before\?\./);
    assert.doesNotMatch(reorder, /Node\.prototype\.insertBefore/);
    assert.match(reorder, /if\(source_rack !== target_rack\)\{\s*return false;/);
    assert.match(reorder, /dispatchEvent\(new CustomEvent\("opd_custom_column_reordered"\)\)/);
    assert.match(content, /addEventListener\("opd_custom_column_reordered"[\s\S]*?column_settings_save\("", last_load_profile\)/);
});

test("sidebar column additions keep the add-placeholder at the visual right edge", () => {
    assert.match(columnDom, /function get_add_target\(doc, is_shift_pressed\)/);
    assert.match(columnDom, /function add_column\(doc, type, template, settings_api/);
    assert.match(content, /function add_new_column\(type\)\{[\s\S]*?column_dom\.add_column\(/);
    assert.match(columnDom, /reorder_api\?\.move_before\?\.\(new_column, add_target_column\)/);
    assert.equal((content.match(/add_new_column\("(?:post|home|notification|explore)"\)/g) ?? []).length, 4);
});

test("profile initialization and saving share the settings boundary", () => {
    assert.match(content, /column_settings\.render_profile\(\s*settings\.column_settings/);
    assert.match(content, /rendered_profile\.first_rack_html/);
    assert.match(content, /rendered_profile\.second_rack_html/);
    assert.match(content, /column_settings\.read_profile\(\s*document,/);
});

test("column load recovery does not force a post-column src reload", () => {
    assert.doesNotMatch(content, /column\.src = column\.src/);
});

test("text review always has a timeout and failure recovery", () => {
    assert.match(background, /new AbortController\(\)/);
    assert.match(background, /setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
    assert.match(background, /finally\s*\{\s*clearTimeout\(timeout_id\)/);
    assert.match(textReview, /this\.UITexts\[requested_lang\].*\? requested_lang : "en"/);
    assert.match(textReview, /finally\s*\{\s*review_state = false/);
});

test("column width preset mapping lives in the settings boundary", () => {
    assert.match(columnSettings, /const WIDTH_PRESETS = \[15, 20, 30\]/);
    assert.equal((content.match(/column_settings\.width_preset_index\(/g) ?? []).length, 2);
    assert.equal((content.match(/column_settings\.width_from_preset\(/g) ?? []).length, 1);
    assert.doesNotMatch(content, /case '15':/);
    assert.doesNotMatch(content, /case 15:/);
});

test("settings initialization takes the default profile from the settings boundary", () => {
    assert.match(columnSettings, /function default_profile\(\)/);
    assert.match(content, /const profile_store_default = column_settings\.default_profile\(\);/);
    assert.doesNotMatch(content, /const profile_store_default = \[\{type:"main_bar_empty_column"/);
});

test("profile switch confirmation builds its summary in the settings boundary", () => {
    assert.match(columnSettings, /function profile_summary\(profile, i18n_message\)/);
    assert.match(content, /const preload_desc_array = column_settings\.profile_summary\(profile_store\[index\]\.profile, i18n_message\);/);
    assert.ok(content.includes('preload_desc_array.join("\\r\\n")'));
    assert.doesNotMatch(content, /msg_profile_desc_misskey_column/);
    assert.doesNotMatch(content, /preload_desc_count/);
});
