import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadSafeValues() {
    const context = { window: {}, URL };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/safe_values.js", "utf8"), context);
    return context.window.opd_custom_safe_values;
}

test("attribute templates escape imported and live values", () => {
    const safe = loadSafeValues();
    const rendered = safe.render_attribute_template(
        '<div title="%title%" data-path="%path%"></div>',
        { "%title%": '"><iframe src="https://evil.example">', "%path%": "/search?q=a&b=1" }
    );
    assert.equal(
        rendered,
        '<div title="&quot;&gt;&lt;iframe src=&quot;https://evil.example&quot;&gt;" data-path="/search?q=a&amp;b=1"></div>'
    );
});

test("only same-origin X paths and HTTPS media URLs are accepted", () => {
    const safe = loadSafeValues();
    assert.equal(safe.is_safe_x_path("/search?q=Open-Deck"), true);
    assert.equal(safe.is_safe_x_path("//evil.example/path"), false);
    assert.equal(safe.is_safe_x_path("https://evil.example/path"), false);
    assert.equal(safe.is_safe_x_path("/path\u0000bad"), false);
    assert.equal(safe.normalize_https_url("https://pbs.twimg.com/media/file.jpg"), "https://pbs.twimg.com/media/file.jpg");
    assert.equal(safe.normalize_https_url("javascript:alert(1)"), null);
    assert.equal(
        safe.normalize_https_url('https://example.com/" onerror=alert(1)'),
        "https://example.com/%22%20onerror=alert(1)"
    );
});

test("video selection prefers the highest bitrate HTTPS MP4 regardless of array order", () => {
    const safe = loadSafeValues();
    const variants = [
        { content_type: "application/x-mpegURL", url: "https://video.example/stream.m3u8" },
        { content_type: "video/mp4", bitrate: 256000, url: "https://video.example/low.mp4" },
        { content_type: "video/mp4", bitrate: 2176000, url: "https://video.example/high.mp4" },
        { content_type: "video/mp4", bitrate: 9999999, url: "javascript:alert(1)" },
    ];
    assert.equal(safe.select_video_variant_url(variants), "https://video.example/high.mp4");
    assert.equal(safe.select_video_variant_url([{ content_type: "video/mp4", url: "https://video.example/gif.mp4" }]), "https://video.example/gif.mp4");
    assert.equal(safe.select_video_variant_url([]), null);
});
