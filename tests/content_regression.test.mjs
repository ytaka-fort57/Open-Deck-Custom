import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const content = readFileSync("content.js", "utf8");
const background = readFileSync("background.js", "utf8");
const textReview = readFileSync("extensions/text_review.js", "utf8");

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
    assert.match(content, /const auto_reload_disposers = new Set\(\)/);
    assert.match(content, /is_page_observer_initialized/);
    assert.match(content, /is_page_event_listener_initialized/);
    assert.match(content, /const media_viewer_tokens_by_frame = new WeakMap\(\)/);
    assert.match(content, /media_viewer_tokens_by_frame\.set\(column_frame,/);
    assert.doesNotMatch(content, /media_viewer_token\.push/);
});

test("text review always has a timeout and failure recovery", () => {
    assert.match(background, /new AbortController\(\)/);
    assert.match(background, /setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
    assert.match(background, /finally\s*\{\s*clearTimeout\(timeout_id\)/);
    assert.match(textReview, /this\.UITexts\[requested_lang\].*\? requested_lang : "en"/);
    assert.match(textReview, /finally\s*\{\s*review_state = false/);
});
