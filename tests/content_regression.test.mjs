import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const content = readFileSync("content.js", "utf8");
const background = readFileSync("background.js", "utf8");
const textReview = readFileSync("extensions/text_review.js", "utf8");
const textReviewHelper = readFileSync("extensions/text_review_helper.js", "utf8");
const lifecycle = readFileSync("extensions/custom/lifecycle.js", "utf8");
const mediaViewer = readFileSync("extensions/media_viewer/media_viewer.js", "utf8");
const settingsImport = readFileSync("extensions/custom/settings_import.js", "utf8");

test("new auto-reload columns use seconds in the UI", () => {
    const tenSecondTemplates = content.match(/replaceAll\("%column_auto_reload_time%", "10"\)/g) ?? [];
    assert.ok(tenSecondTemplates.length >= 2);
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
    assert.match(content, /deck_safe_values\.render_attribute_template/);
    assert.doesNotMatch(mediaViewer, /src="\$\{/);
    assert.doesNotMatch(mediaViewer, /wrapper\.innerHTML/);
    assert.match(mediaViewer, /normalize_https_url/);
});

test("remaining audit hardening paths are wired", () => {
    assert.match(content, /start_auto_reload\(Number\(auto_reload_time\.value\) \* 1000\)/);
    assert.match(content, /const read_explore_state = function/);
    assert.match(settingsImport, /reader\.addEventListener\("error"/);
});

test("column back buttons use the target frame's independent history", () => {
    const customIndex = readFileSync("extensions/custom/index.js", "utf8");
    assert.match(customIndex, /button\[data-testid=["']app-bar-back["']\]/);
    assert.match(customIndex, /column_history\.can_back\(iframe\)/);
    assert.match(customIndex, /column_history\.back\(iframe\)/);
    assert.match(customIndex, /event\.stopImmediatePropagation\(\)/);
});

test("top visibility keeps timeline tabs available", () => {
    assert.match(content, /function get_top_visible_css\(column_type, legacy_mode = false\)/);
    assert.match(content, /:not\(:has\(\[role="tab"\]\)\)/);
    assert.ok((content.match(/get_top_visible_css\(/g) ?? []).length >= 4);
    assert.doesNotMatch(content, />div:nth-child\(1\)\{visibility: hidden;/);
    assert.doesNotMatch(content, />div:nth-child\(1\)\{display:none;/);
});

test("post top visibility hides only the composer and keeps back navigation", () => {
    assert.match(content, /if\(column_type == "post"\)/);
    assert.match(content, /tweetTextarea_0/);
    assert.match(content, /app-bar-back.*display:block/);
    assert.match(textReviewHelper, /back_button\.style\.display = "block"/);
    assert.doesNotMatch(textReviewHelper, /back_button\.style\.display = "none"/);
});

test("text review always has a timeout and failure recovery", () => {
    assert.match(background, /new AbortController\(\)/);
    assert.match(background, /setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
    assert.match(background, /finally\s*\{\s*clearTimeout\(timeout_id\)/);
    assert.match(textReview, /this\.UITexts\[requested_lang\].*\? requested_lang : "en"/);
    assert.match(textReview, /finally\s*\{\s*review_state = false/);
});
