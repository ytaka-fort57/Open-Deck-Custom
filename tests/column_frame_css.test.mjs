import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadColumnFrameCss() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/column_frame_css.js", "utf8"), context);
    return context.window.opd_custom_column_frame_css;
}

//head と style だけを持つ最小のdocument。head は document 自身が兼ねる
class DocumentFixture {
    constructor(hasHead = true) {
        this.hasHead = hasHead;
        this.styles = [];
        this.created = 0;
    }
    querySelector(selector) {
        if (selector === "head") return this.hasHead ? this : null;
        return this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector) {
        const attr = selector.match(/^style\[(\w+)\]$/)?.[1];
        return this.styles.filter((style) => style.attributes.has(attr));
    }
    createElement(tag) {
        assert.equal(tag, "style");
        this.created += 1;
        return {
            attributes: new Map(),
            textContent: "",
            setAttribute(name, value) { this.attributes.set(name, value); },
        };
    }
    appendChild(style) { this.styles.push(style); }
}

const TOP_CHILD = 'div[data-testid="primaryColumn"]>[tabindex="0"][aria-label]>div:nth-child(1)';
const HIDDEN = "visibility:hidden; height:0; top:calc(100vh - 60px); position:sticky; backdrop-filter:blur(0px) !important;";

test("banner css is a single display:none rule and empty when visible", () => {
    const css = loadColumnFrameCss();
    assert.equal(css.banner_css(true), "");
    assert.equal(css.banner_css(false), 'header[role="banner"]{display:none;}');
    //変更前に混在していた visibility:hidden; width:0 版は使わない
    assert.doesNotMatch(css.banner_css(false), /visibility/);
});

test("top visible css keeps tabs, differs by column type and legacy mode, and is empty when visible", () => {
    const css = loadColumnFrameCss();
    assert.equal(css.top_visible_css("home", true), "");
    assert.equal(css.top_visible_css("post", true, true), "");

    assert.equal(
        css.top_visible_css("home", false),
        `${TOP_CHILD}:not(:has([role="tab"])){${HIDDEN}}`
        + `${TOP_CHILD} div:has(form[role="search"]):not(:has([role="tab"])){${HIDDEN}}`
        + `${TOP_CHILD} div:has(h2[role="heading"]):not(:has([role="tab"])){${HIDDEN}}`
        + '[data-testid="app-bar-back"]{visibility:visible; filter:none;}'
        + 'div[role="progressbar"] + div{display:none;}'
        + 'div[data-testid="cellInnerDiv"]:has(button[aria-describedby], div[data-testid="UserAvatar-Container-unknown"]):not(:has(article[tabindex="-1"])){display:none;}'
    );
    assert.equal(
        css.top_visible_css("home", false, true),
        `${TOP_CHILD}:not(:has([role="tab"])){display:none;}`
        + `${TOP_CHILD} div:has(form[role="search"]):not(:has([role="tab"])){display:none;}`
        + `${TOP_CHILD} div:has(h2[role="heading"]):not(:has([role="tab"])){display:none;}`
        + 'div[role="progressbar"] + div{display:none;}'
    );
    //home 以外は progressbar 直後の要素を隠さない
    assert.doesNotMatch(css.top_visible_css("notification", false), /progressbar/);
    assert.doesNotMatch(css.top_visible_css("explore", false, true), /progressbar|app-bar-back/);
    assert.equal(
        css.top_visible_css("post", false),
        'div[data-testid="tweetTextarea_0"], div[contenteditable="true"][data-testid*="tweetTextarea"]{display:block !important; visibility:visible !important;}'
        + '[data-testid="app-bar-back"]{visibility:visible !important; display:block !important; filter:none;}'
    );
    assert.equal(css.top_visible_css("post", false, true), css.top_visible_css("post", false));
});

test("view mode css maps the select value and falls back to empty", () => {
    const css = loadColumnFrameCss();
    assert.equal(css.view_mode_css("0"), "");
    assert.equal(css.view_mode_css("1"), 'div[data-testid="cellInnerDiv"]:has(div[aria-labelledby]){visibility: hidden; height: 0;}');
    assert.equal(css.view_mode_css("2"), 'div[data-testid="cellInnerDiv"]:not(:has(div[aria-labelledby])){visibility: hidden; height: 0;}');
    assert.equal(css.view_mode_css(1), css.view_mode_css("1"));
    assert.equal(css.view_mode_css("9"), "");
    assert.equal(css.view_mode_css(undefined), "");
    assert.equal(css.view_mode_css(null), "");
});

test("apply creates one style per attribute and only rewrites its text", () => {
    const css = loadColumnFrameCss();
    const doc = new DocumentFixture();

    const first = css.apply(doc, "opd_banner_css", "a{}");
    assert.equal(doc.created, 1);
    assert.deepEqual([...first.attributes.entries()], [["opd_banner_css", ""]]);
    assert.equal(first.textContent, "a{}");

    const second = css.apply(doc, "opd_banner_css", "b{}");
    assert.equal(second, first);
    assert.equal(doc.created, 1);
    assert.equal(doc.styles.length, 1);
    assert.equal(first.textContent, "b{}");

    css.apply(doc, "opd_top_visible_css", "");
    assert.equal(doc.styles.length, 2);
    assert.equal(doc.styles[1].textContent, "");

    assert.equal(css.apply(new DocumentFixture(false), "opd_banner_css", "a{}"), null);
    assert.equal(css.apply(null, "opd_banner_css", "a{}"), null);
    assert.equal(css.apply(undefined, "opd_banner_css", "a{}"), null);
});
