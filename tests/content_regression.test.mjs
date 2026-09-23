//本家ファイル(content.js / background.js / extensions/*.js)は実行テストに載せられないため、
//ソース文字列でカスタム版の差分が残っていることを確認する。
//
//extensions/custom/ の各モジュールは実行テストで振る舞いを固定する。ここに残すのは
//「二重実装・復活してはいけない書き方」を止める doesNotMatch だけで、あることの確認は置かない。
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
const columnFrameCss = readFileSync("extensions/custom/column_frame_css.js", "utf8");
const safeValues = readFileSync("extensions/custom/safe_values.js", "utf8");

test("the sidebar add buttons pass the Shift state to the settings boundary", () => {
    assert.match(content, /add_new_column\(config\.type, event\.shiftKey\)/);
    assert.doesNotMatch(content, /replaceAll\("%column_auto_reload_time%"/);
});

test("auto reload controls stay in the handler scope and columns expose a manual refresh", () => {
    const start_index = content.indexOf("const start_auto_reload = function");
    const branch_index = content.indexOf("if(opd_column_auto_reload_checkbox != null){");
    assert.ok(start_index > 0 && branch_index > start_index);
    assert.match(content, /const reload_column_content = function/);
    assert.match(content, /opd_column_reload_btn\.addEventListener\("click"/);
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
    assert.match(content, /deck_lifecycle\.register_media_viewer_token\(column_frame,/);
    assert.match(content, /deck_lifecycle\.initialize_page_observers/);
    assert.match(content, /deck_lifecycle\.dispose_column_resources_in/);
    assert.doesNotMatch(columnDom, /watch_load_column/);
    assert.doesNotMatch(content, /column_dom\.watch_load_column/);
    //iframe単位の load リスナーは lifecycle 経由で1回だけ登録し、削除時に外す(R-12)
    for (const key of ["frame-css", "frame-init"]) {
        assert.ok(content.includes(`deck_lifecycle.register_column_resource(column_frame, "${key}"`), `missing ${key}`);
    }
    assert.match(content, /deck_lifecycle\.register_column_resource\(exp_object, "explore-url"/);
    assert.doesNotMatch(content, /opd_column_ui_loader_added/);
    assert.doesNotMatch(content, /session_set/);
    //引数なしの全iframe再走査は残さない(削除時の再初期化は行わない)
    assert.doesNotMatch(content, /^\s*append_object_css\(\);/m);
    assert.match(content, /append_object_css\(document\.querySelectorAll\('#main_rack_element iframe\[opd_init_webview\]'\)\);/);
    assert.equal((content.match(/append_object_css\(all_webview\);/g) ?? []).length, 1);
    assert.match(content, /column_dom\.dispose_and_remove/);
    assert.doesNotMatch(content, /function observe_when_ready/);
    assert.doesNotMatch(content, /function set_title_favicon/);
    assert.doesNotMatch(content, /media_viewer_token\.push/);
});

test("column extensions are initialized from one typed registry", () => {
    assert.match(content, /const column_extension_registry = \[/);
    assert.match(content, /types: \["post"\]/);
    assert.match(content, /types: \["home", "explore"\]/);
    assert.match(content, /column_extension_registry\.forEach/);
    assert.match(content, /extension\.types == null \|\| extension\.types\.includes\(column_type\)/);

    const reinit = content.slice(
        content.indexOf("function reinit_column_extensions"),
        content.indexOf("function snapshot_timeline_state")
    );
    assert.doesNotMatch(reinit, /column_type ===/);
    assert.match(reinit, /column_frame\.addEventListener\("load", ext_load\)/);
    assert.match(content, /register_media_viewer_token\(column_frame, blocker\.opd_send_media_info_token\)/);
});

test("settings and profiles use the shared storage repository", () => {
    assert.match(content, /const deck_storage = window\.opd_custom_storage/);
    assert.match(content, /deck_storage\.get_json_many/);
    assert.match(content, /deck_storage\.update_json/);
    assert.doesNotMatch(content, /chrome\.storage\.local/);
});

test("untrusted values cross explicit safe DOM and URL boundaries", () => {
    assert.match(content, /column_settings\.render/);
    assert.doesNotMatch(mediaViewer, /src="\$\{/);
    assert.doesNotMatch(mediaViewer, /wrapper\.innerHTML/);
    assert.match(mediaViewer, /resolve_media_url/);
    assert.match(safeValues, /function resolve_media_url[\s\S]*?normalize_https_url/);
});

test("remaining audit hardening paths are wired", () => {
    assert.match(content, /start_auto_reload\(Number\(auto_reload_time\.value\) \* 1000\)/);
    assert.match(content, /const read_explore_state = function/);
    //URLとタイトルを一緒に保存するとタイトルが1ページ前のまま残るため、差分は純粋関数側で出す
    assert.match(content, /column_settings\.explore_state_changes\(/);
    assert.doesNotMatch(content, /element\.setAttribute\("opd_explore_title", current_state\.title\)/);
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
    assert.ok((content.match(/column_frame_css\.top_visible_css\(/g) ?? []).length >= 3);
    assert.doesNotMatch(content, /function get_top_visible_css/);
    assert.doesNotMatch(columnFrameCss, />div:nth-child\(1\)\{visibility: hidden;/);
    assert.doesNotMatch(columnFrameCss, />div:nth-child\(1\)\{display:none;/);
});

test("post top visibility hides only the composer and keeps back navigation", () => {
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
    assert.match(content, /reorder_api\?\.move_before\?\./);
    assert.doesNotMatch(reorder, /Node\.prototype\.insertBefore/);
    assert.match(content, /addEventListener\("opd_custom_column_reordered"[\s\S]*?save_current_profile\(last_load_profile\)/);
    //並び替え保存リスナーは run() の外で1回だけ登録する。run() 内だとプロファイル切替ごとに増える(R-13)
    assert.equal((content.match(/addEventListener\("opd_custom_column_reordered"/g) ?? []).length, 1);
    assert.match(content, /^document\.addEventListener\("opd_custom_column_reordered"/m);
    assert.match(content, /^function read_current_profile\(\)/m);
    assert.match(content, /^function save_current_profile\(profile_num\)/m);
    assert.doesNotMatch(content, /column_settings_save/);
});

test("sidebar column additions keep the add-placeholder at the visual right edge", () => {
    assert.match(content, /function add_new_column\(type, is_shift_pressed\)\{[\s\S]*?column_dom\.add_column\(/);
    assert.match(content, /\{id: "add_post", type: "post", remap_timeline: false\}/);
    assert.match(content, /\{id: "add_timeline", type: "home", remap_timeline: true\}/);
    assert.match(content, /\{id: "add_notify", type: "notification", remap_timeline: false\}/);
    assert.match(content, /\{id: "add_explore", type: "explore", remap_timeline: false\}/);
    assert.match(content, /function finalize_added_column\(new_column_element, timeline_before\)[\s\S]*?remap_timeline_state\(timeline_before\)[\s\S]*?append_object_css\(all_webview\)[\s\S]*?column_dd\(\)[\s\S]*?column_close\(\)[\s\S]*?save_current_profile\(last_load_profile\)/);
    assert.equal((content.match(/add_new_column\(config\.type, event\.shiftKey\)/g) ?? []).length, 1);
    assert.equal((content.match(/finalize_added_column\(new_column_element, timeline_before\)/g) ?? []).length, 2);
    //Shift押下はクリックイベントから読む。グローバルな keydown/keyup 追跡は残さない。
    assert.doesNotMatch(content, /let is_shift_pressed = false/);
    assert.doesNotMatch(content, /event\.key === 'Shift'/);
});

test("media preview and download share the safe URL resolver", () => {
    assert.equal((mediaViewer.match(/opd_custom_safe_values\.resolve_media_url\(/g) ?? []).length, 2);
    assert.doesNotMatch(mediaViewer, /select_video_variant_url|searchParams\.set\("name", "orig"\)/);
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

test("text review apply falls back when X no longer exposes Draft _onPaste", () => {
    assert.match(textReviewHelper, /typeof editor\?\._onPaste === "function"/);
    assert.match(textReviewHelper, /new InputEvent\("beforeinput",[\s\S]*?inputType: "insertText"/);
    assert.match(textReviewHelper, /target_editor_elem\.dispatchEvent\(input_evt\)/);
    assert.match(textReviewHelper, /if\(!input_evt\.defaultPrevented\)[\s\S]*?target_editor_elem\.dispatchEvent\(evt\)/);
    assert.match(textReviewHelper, /if\(!input_evt\.defaultPrevented && !evt\.defaultPrevented && !setEditorText\(target_editor_elem, detail\.text\)\)[\s\S]*?execCommand\("insertText", false, detail\.text\)/);
    assert.match(textReviewHelper, /const candidates = \[[\s\S]*?fiber\.stateNode,[\s\S]*?fiber\.memoizedProps\?\.editor/);
    assert.match(textReviewHelper, /candidate\._latestEditorState \|\| candidate\.props\?\.editorState/);
});

test("column width preset mapping lives in the settings boundary", () => {
    assert.equal((content.match(/column_settings\.width_preset_index\(/g) ?? []).length, 2);
    assert.equal((content.match(/column_settings\.width_from_preset\(/g) ?? []).length, 1);
    assert.doesNotMatch(content, /case '15':/);
    assert.doesNotMatch(content, /case 15:/);
});

test("settings initialization takes the default profile from the settings boundary", () => {
    assert.match(content, /const profile_store_default = column_settings\.default_profile\(\);/);
    assert.doesNotMatch(content, /const profile_store_default = \[\{type:"main_bar_empty_column"/);
});

test("profile switch confirmation builds its summary in the settings boundary", () => {
    assert.match(content, /const preload_desc_array = column_settings\.profile_summary\(profile_store\[index\]\.profile, i18n_message\);/);
    assert.ok(content.includes('preload_desc_array.join("\\r\\n")'));
    assert.doesNotMatch(content, /msg_profile_desc_misskey_column/);
    assert.doesNotMatch(content, /preload_desc_count/);
});

test("profile list rendering is centralized and avoids the settings module shadow", () => {
    assert.equal((content.match(/function render_profile_buttons\(\)/g) ?? []).length, 1);
    assert.equal((content.match(/function render_profile_sidebar\(\)/g) ?? []).length, 1);
    assert.equal((content.match(/function refresh_profile_list\(/g) ?? []).length, 1);
    assert.doesNotMatch(content, /const column_settings = \{column_settings:profile_store/);
    assert.match(content, /const profile_settings = \{column_settings:profile_store/);
});

test("the lifecycle composition point holds no state of its own", () => {
    //合成点は状態(Set/WeakMap/初期化フラグ)を持たず、3モジュールの入口だけを公開する
    assert.doesNotMatch(lifecycle, /new Set\(\)|new WeakMap\(\)|new MutationObserver/);});

test("small utilities have a single implementation", () => {
    const safeValues = readFileSync("extensions/custom/safe_values.js", "utf8");
    const indexJs = readFileSync("extensions/custom/index.js", "utf8");
    const listRepostFilter = readFileSync("extensions/custom/list_repost_filter.js", "utf8");
    const shortPostFilter = readFileSync("extensions/custom/short_post_filter.js", "utf8");

    //ランダムIDとHTMLエスケープの実体は safe_values だけに置く
    assert.match(content, /const create_random_id = deck_safe_values\.create_random_id;/);
    assert.doesNotMatch(content, /function create_random_id\(\)/);
    assert.match(textReview, /window\.opd_custom_safe_values\.create_random_id\(\)/);
    assert.match(textReview, /window\.opd_custom_safe_values\.escape_html_attribute\(str\)/);
    assert.doesNotMatch(textReview, /Math\.random\(\)\.toString\(32\)/);
    assert.doesNotMatch(textReview, /replace\(\/&\/g, '&amp;'\)/);

    //iframeの読み込み判定は column_dom に1つだけ置く
    for (const source of [indexJs, listRepostFilter, shortPostFilter]) {
        assert.match(source, /column_dom\.is_frame_loaded\(iframe\)/);
        assert.doesNotMatch(source, /function is_loaded\(iframe\)/);
    }
});

test("periodic work is shared instead of allocated per column", () => {
    const indexJs = readFileSync("extensions/custom/index.js", "utf8");
    const listRepostFilter = readFileSync("extensions/custom/list_repost_filter.js", "utf8");
    const shortPostFilter = readFileSync("extensions/custom/short_post_filter.js", "utf8");

    //デッキ側のMutationObserverは冪等な全体走査をまとめてから呼ぶ。
    //index.js は location で自分を止める入口のため、実行テストには載せられない
    assert.match(indexJs, /new MutationObserver\(schedule_setup\)/);
    assert.match(indexJs, /function schedule_setup\(\)/);
    for (const source of [listRepostFilter, shortPostFilter]) {
        assert.match(source, /const watched_states = new Set\(\)/);
        assert.match(source, /watched_states\.forEach/);
        assert.doesNotMatch(source, /state\.path_timer/);
    }
});

test("auto update re-checks the live text focus before staying paused", () => {
    //入力中のカラムが消えると focusout が届かず、イベントの状態だけでは自動更新が止まり続ける(BL-065)
    assert.match(content, /function is_auto_update\(\)\{[\s\S]*?text_focus\.active\)\{\s*if\(column_dom\.has_column_text_focus\(document\)\)\{\s*return false;[\s\S]*?text_focus\.active = false;/);
});
