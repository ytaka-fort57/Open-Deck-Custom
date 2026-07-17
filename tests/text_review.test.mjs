import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function createReview(sendMessage) {
    const source = `${readFileSync("extensions/text_review.js", "utf8")}\nthis.TestClass = OpdExtTextReview;`;
    const scriptElement = { addEventListener() {}, set src(value) { this.value = value; } };
    const document = {
        head: { insertAdjacentHTML() {}, appendChild() {} },
        createElement: () => scriptElement,
        addEventListener() {},
        querySelector: () => null
    };
    const context = {
        chrome: { runtime: { getURL: (value) => value, sendMessage } },
        crypto: { randomUUID: () => "token" },
        MutationObserver: class { observe() { return this; } },
        CustomEvent: class {},
        CSS: { supports: () => true },
        String
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return { review: new context.TestClass(), document };
}

test("unsupported UI language falls back to English", () => {
    const { review, document } = createReview(async () => false);
    review.Init(
        { contentWindow: { document, location: { pathname: "/" } } },
        { text_review: "text.svg", hashtag_restore: "tag.svg" },
        "fr-FR"
    );
    assert.equal(review.opd_use_lang, "en");
});

test("message rejection returns a normal review failure", async () => {
    const { review } = createReview(async () => { throw new Error("disconnected"); });
    assert.equal(await review.ReviewRquest("text"), false);
});

test("indications are sorted and invalid overlaps are removed", () => {
    const { review } = createReview(async () => false);
    const normalized = review.NormalizeIndications("abcdef", [
        { offset: 3, length: 2, problem: "de", suggest: "DE" },
        { offset: 1, length: 3, problem: "bcd", suggest: "BCD" },
        { offset: 99, length: 1, problem: "x", suggest: "X" }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), [
        { offset: 1, length: 3, problem: "bcd", suggest: "BCD" }
    ]);
});
