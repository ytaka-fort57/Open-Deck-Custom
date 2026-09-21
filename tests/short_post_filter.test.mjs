import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadFilter(){
    const context = { URL, console: { warn() {} } };
    context.window = {};
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/short_post_filter.js", "utf8"), context);
    return context.window.opd_custom_short_post_filter;
}

function link(href, attributes = {}){
    return {
        getAttribute: (name) => name === "href" ? href : attributes[name] ?? null,
    };
}

function article({
    body = "",
    links = [],
    author = "/Alice",
    media = false,
    postId = null,
} = {}){
    const tweetText = {
        textContent: body,
        querySelectorAll: (selector) => selector === "a[href]" ? links : [],
    };
    const userName = {
        querySelectorAll: (selector) => selector === "a[href]" ? [link(author)] : [],
    };
    const statusLink = postId == null ? [] : [link(`/Alice/status/${postId}`)];
    const classes = new Set();
    return {
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        closest: () => null,
        querySelector: (selector) => {
            if(selector === '[data-testid="tweetText"]') return tweetText;
            if(selector === '[data-testid="User-Name"]') return userName;
            if(selector === '[data-testid="tweetPhoto"]' && media) return {};
            return null;
        },
        querySelectorAll: (selector) => selector === "a[href]" ? statusLink : [],
    };
}

function documentFor(articles){
    return {
        head: {
            querySelector: () => null,
            appendChild: () => {},
        },
        createElement: () => ({
            setAttribute: () => {},
            textContent: "",
        }),
        querySelectorAll: (selector) => selector === 'article[data-testid="tweet"]' ? articles : [],
    };
}

test("shortener detection is limited to known domains", () => {
    const filter = loadFilter();
    assert.equal(filter.shortener_host_from_url("https://t.co/example"), "t.co");
    assert.equal(filter.shortener_host_from_url("https://bit.ly/example"), "bit.ly");
    assert.equal(filter.shortener_host_from_url("https://example.com/article"), null);
});

test("post features read body, bait words, short links, media, and author", () => {
    const filter = loadFilter();
    const features = filter.extract_post_features(article({
        body: "続きはこちら ↓",
        links: [link("https://t.co/abc", { title: "https://example.com/long" })],
        media: true,
        postId: "123",
    }));
    assert.equal(features.short_text, true);
    assert.equal(features.bait_phrase, true);
    assert.equal(features.short_link, true);
    assert.equal(features.short_link_host, "t.co");
    assert.equal(features.expanded_host, "example.com");
    assert.equal(features.has_media, true);
    assert.equal(features.author_key, "alice");
    assert.equal(features.post_id, "123");
});

test("one or two isolated signals stay visible in the recommended three-signal mode", () => {
    const filter = loadFilter();
    assert.equal(filter.should_hide({ short_text: true, bait_phrase: false, short_link: false, repeated: false }), false);
    assert.equal(filter.should_hide({ short_text: true, bait_phrase: true, short_link: false, repeated: false }), false);
    assert.equal(filter.should_hide({ short_text: true, bait_phrase: true, short_link: true, repeated: false }), true);
});

test("media can be required as an additional safety gate", () => {
    const filter = loadFilter();
    const features = { short_text: true, bait_phrase: true, short_link: true, repeated: false, has_media: false };
    assert.equal(filter.should_hide(features), true);
    assert.equal(filter.should_hide(features, { require_media: true }), false);
});

test("the DOM filter hides only the repeated post after the second observation", () => {
    const filter = loadFilter();
    const first = article({ body: "続きはこちら 100", postId: "1" });
    const second = article({ body: "続きはこちら 200", postId: "2" });
    const result = filter.apply_filter(documentFor([first, second]), { now: 1000 });
    assert.equal(result.hidden, 1);
    assert.equal(first.classList.contains("opd_custom_short_post_filter_hidden"), false);
    assert.equal(second.classList.contains("opd_custom_short_post_filter_hidden"), true);
});

test("timeline path matching does not accept unrelated path prefixes", () => {
    const filter = loadFilter();
    assert.equal(filter.should_apply_path("/home"), true);
    assert.equal(filter.should_apply_path("/explore"), true);
    assert.equal(filter.should_apply_path("/explore/topics"), true);
    assert.equal(filter.should_apply_path("/explorex"), false);
    assert.equal(filter.should_apply_path("/searching"), false);
});

test("same-author repeated templates can supply the third signal", () => {
    const filter = loadFilter();
    const first = article({ body: "続きはこちら 100", postId: "1" });
    const second = article({ body: "続きはこちら 200", postId: "2" });
    const firstFeatures = filter.extract_post_features(first);
    const secondFeatures = filter.extract_post_features(second);
    assert.equal(firstFeatures.fingerprint, secondFeatures.fingerprint);
    assert.equal(filter.record_repeat(firstFeatures, 1000, filter.DEFAULT_CONFIG), false);
    assert.equal(filter.record_repeat(secondFeatures, 1001, filter.DEFAULT_CONFIG), true);
    assert.equal(filter.signal_count(firstFeatures), 2);
    secondFeatures.repeated = true;
    assert.equal(filter.signal_count(secondFeatures), 3);
});

test("normalization makes template fingerprints stable across case and whitespace", () => {
    const filter = loadFilter();
    assert.equal(
        filter.template_fingerprint("続きはこちら 100"),
        filter.template_fingerprint(" 続きはこちら　200 ")
    );
});
