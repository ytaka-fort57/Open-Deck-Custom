import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadDeckUrl() {
    const context = { window: {}, URL };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/deck_url.js", "utf8"), context);
    return context.window.opd_custom_deck_url;
}

test("deck URL accepts redirect query, hash, trailing slash and subdomains", () => {
    const deck = loadDeckUrl();
    for (const href of [
        "https://x.com/run-opdeck",
        "https://twitter.com/run-opdeck",
        "https://x.com/run-opdeck?mx=1",
        "https://x.com/run-opdeck/",
        "https://x.com/run-opdeck#top",
        "https://www.x.com/run-opdeck",
        "https://mobile.twitter.com/run-opdeck?lang=ja",
    ]) {
        assert.equal(deck.is_deck_url(href), true, href);
    }
});

test("deck URL rejects other pages, hosts and schemes", () => {
    const deck = loadDeckUrl();
    for (const href of [
        "https://x.com/home",
        "https://x.com/run-opdeck/extra",
        "https://x.com/run-opdeck_test.html",
        "https://x.com/i/run-opdeck",
        "http://x.com/run-opdeck",
        "https://evilx.com/run-opdeck",
        "https://x.com.evil.example/run-opdeck",
        "not a url",
        "",
    ]) {
        assert.equal(deck.is_deck_url(href), false, href);
    }
});
