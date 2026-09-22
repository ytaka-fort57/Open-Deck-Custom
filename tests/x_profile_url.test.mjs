import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadAll(){
    const context = { URL, console: { warn() {} } };
    context.window = { opd_custom_column_dom: { is_frame_loaded: () => true } };
    vm.createContext(context);
    for (const file of ["x_profile_url.js", "list_repost_filter.js", "short_post_filter.js"]) {
        vm.runInContext(readFileSync(`extensions/custom/${file}`, "utf8"), context);
    }
    return context.window;
}

test("profile_key_from_href は X の単一パスだけを小文字のキーにする", () => {
    const { profile_key_from_href } = loadAll().opd_custom_x_profile_url;
    const cases = [
        ["/Alice", "alice"],
        ["Alice", "alice"],
        ["/Alice/", "alice"],
        ["https://x.com/Alice", "alice"],
        ["https://twitter.com/ALICE", "alice"],
        ["https://x.com/Alice?s=20", "alice"],
        ["/%E3%81%82", "あ"],
        ["https://example.com/Alice", null],
        ["https://mobile.x.com/Alice", null],
        ["/Alice/status/123", null],
        ["/i/lists/1", null],
        ["/", null],
        ["", null],
        [null, null],
        [undefined, null],
        [42, null],
        ["/%E0%A4%A", null],
        ["http://[invalid", null],
    ];
    for (const [href, expected] of cases) {
        assert.equal(profile_key_from_href(href), expected, String(href));
    }
});

test("予約パスは大小文字を問わずプロフィールとみなさない", () => {
    const { EXCLUDED_PROFILE_PATHS, profile_key_from_href } = loadAll().opd_custom_x_profile_url;
    assert.ok(EXCLUDED_PROFILE_PATHS.size > 0);
    for (const path of EXCLUDED_PROFILE_PATHS) {
        assert.equal(profile_key_from_href(`/${path}`), null, path);
        assert.equal(profile_key_from_href(`https://x.com/${path.toUpperCase()}`), null, path);
    }
});

test("2つのフィードフィルタは同じ抽出関数を使う", () => {
    const window = loadAll();
    const shared = window.opd_custom_x_profile_url.profile_key_from_href;
    assert.equal(window.opd_custom_list_repost_filter.profile_key_from_href, shared);
    assert.equal(window.opd_custom_short_post_filter.profile_key_from_href, shared);
    for (const file of ["list_repost_filter.js", "short_post_filter.js"]) {
        const source = readFileSync(`extensions/custom/${file}`, "utf8");
        assert.doesNotMatch(source, /EXCLUDED_PROFILE_PATHS|function profile_key_from_href/, file);
    }
});
