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
        window: {},
        chrome: { runtime: { getURL: (value) => value, sendMessage } },
        crypto: { randomUUID: () => "token" },
        MutationObserver: class { observe() { return this; } },
        CustomEvent: class {
            constructor(type, options) {
                this.type = type;
                this.detail = options?.detail;
            }
        },
        CSS: { supports: () => true },
        String
    };
    vm.createContext(context);
    //本家クラスは helper 注入を共通関数へ委譲するため、manifest と同じく先に読み込む
    vm.runInContext(readFileSync("extensions/custom/safe_values.js", "utf8"), context);
    vm.runInContext(readFileSync("extensions/custom/helper_injector.js", "utf8"), context);
    vm.runInContext(readFileSync("extensions/custom/text_review_model.js", "utf8"), context);
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

test("review model handles empty, out-of-range, overlapping, and unicode indications", () => {
    const { review } = createReview(async () => false);
    const text = "A😀BCDE";
    const normalized = review.NormalizeIndications(text, [
        { offset: 1, length: 1 },
        { offset: 1, length: 2, params: { suggests: ["🙂"] } },
        { offset: 2, length: 1 },
        { offset: 3, length: 3, params: { suggests: ["x"] } },
        { offset: 5, length: 2 },
        { offset: -1, length: 1 },
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), [
        { offset: 1, length: 2, params: { suggests: ["🙂"] } },
        { offset: 3, length: 3, params: { suggests: ["x"] } },
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(review.NormalizeIndications(text, []))), []);
});

test("preview model and selected application are DOM-free", () => {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/text_review_model.js", "utf8"), context);
    const modelApi = context.window.opd_custom_text_review_model;
    let id = 0;
    const model = modelApi.create_preview_model("A😀BC", [
        { offset: 1, length: 2, params: { suggests: ["🙂"] } },
        { offset: 4, length: 1, params: { suggests: ["D"] } },
    ], () => `id-${++id}`);

    assert.deepEqual(JSON.parse(JSON.stringify(model.segments)), [
        { type: "text", text: "A" },
        { type: "indication", id: "id-1", offset: 1, length: 2, problem: "😀", suggestion: "🙂" },
        { type: "text", text: "B" },
        { type: "indication", id: "id-2", offset: 4, length: 1, problem: "C", suggestion: "D" },
    ]);
    assert.equal(modelApi.apply_selected("A😀BC", model.items), "A😀BC");
    model.items[0].enabled = true;
    assert.equal(modelApi.apply_selected("A😀BC", model.items), "A🙂BC");
    model.items[1].enabled = true;
    assert.equal(modelApi.apply_selected("A😀BC", model.items), "A🙂BD");
});

//校正元エディタ(contenteditable)の最小限の模型
function createSourceEditor(text) {
    const attributes = new Map();
    return {
        innerText: text,
        isConnected: true,
        isContentEditable: true,
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    };
}

//校正パネルの DOM を最小限に模し、チェックと適用ボタンを操作できるようにする
function createReviewPanel(itemIds) {
    const listeners = new Map();
    const checkboxes = new Map(itemIds.map(id => [id, {
        checked: false,
        addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); },
        click() {
            this.checked = !this.checked;
            listeners.get(`${id}:change`)({ target: this });
        },
    }]));
    const problem = {
        scrollIntoView() {},
        setAttribute() {},
        removeAttribute() {},
    };
    const selectedButton = {
        addEventListener(type, callback) { listeners.set(`selected:${type}`, callback); },
    };
    const allButton = { addEventListener(type, callback) { listeners.set(`all:${type}`, callback); } };
    const panel = {
        html: "",
        set textContent(value) { this.html = value; },
        get textContent() { return this.html; },
        insertAdjacentHTML(position, html) { this.html += html; },
        querySelector(selector) {
            const checkboxId = /^#opd_text_review_iid_(\w+)$/.exec(selector)?.[1];
            if(checkboxId) return checkboxes.get(checkboxId) ?? null;
            if(/^#opd_text_review_problem_id_\w+$/.test(selector)) return problem;
            if(selector === "#opd_text_review_apply_selected") return selectedButton;
            if(selector === "#opd_text_review_apply_all") return allButton;
            return null;
        },
    };
    return { panel, checkboxes, listeners };
}

function createInitializedReview(reviewRequest) {
    const { review, document } = createReview(async () => false);
    review.Init(
        { contentWindow: { document, location: { pathname: "/" } } },
        { text_review: "text.svg", hashtag_restore: "tag.svg" },
        "ja"
    );
    let nextId = 0;
    review.CreateRandomID = () => `fixed${++nextId}`;
    review.ReviewRquest = reviewRequest;
    const dispatched = [];
    const columnWindow = { document: { dispatchEvent(event) { dispatched.push(event); } } };
    return { review, dispatched, columnWindow };
}

const TWO_INDICATIONS = {
    indications: [{
        offset: 1,
        length: 1,
        message: "replace",
        relevant_part: { problem: "b", after: "" },
        params: { suggests: ["B"] },
    }, {
        offset: 2,
        length: 1,
        message: "replace",
        relevant_part: { problem: "c", after: "" },
        params: { suggests: ["C"] },
    }],
};

//テストから解決の時点を決められる Promise
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

test("review UI keeps selection and apply communication wired to the pure model", async () => {
    const { review, dispatched, columnWindow } = createInitializedReview(async () => TWO_INDICATIONS);
    assert.equal(review.opd_text_review_token, "token");
    const editor = createSourceEditor("abc");
    //fixed1 は校正元エディタの印、fixed2 / fixed3 が指摘の ID
    const { panel, checkboxes, listeners } = createReviewPanel(["fixed2", "fixed3"]);

    await review.Review("abc", panel, columnWindow, editor);
    assert.equal(editor.getAttribute("opd_text_review_source"), "fixed1");
    assert.match(panel.html, /opd_text_review_problem_id_fixed2/);
    checkboxes.get("fixed2").click();
    listeners.get("selected:click")({});
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, "opd_text_review_apply");
    assert.deepEqual(JSON.parse(dispatched[0].detail), {
        text: "aBc",
        source_text: "abc",
        source_id: "fixed1",
        token: "token",
        is_firefox: false,
    });
    listeners.get("all:click")({});
    assert.equal(dispatched.length, 2);
    assert.equal(checkboxes.get("fixed2").checked, true);
    assert.equal(checkboxes.get("fixed3").checked, true);
    assert.deepEqual(JSON.parse(dispatched[1].detail), {
        text: "aBC",
        source_text: "abc",
        source_id: "fixed1",
        token: "token",
        is_firefox: false,
    });
});

for (const [name, change] of [
    ["text is edited", (editor) => { editor.innerText = "abc added"; }],
    ["editor is removed", (editor) => { editor.isConnected = false; }],
]) {
    test(`review result is discarded when the ${name} while the review is pending`, async () => {
        const pending = deferred();
        const { review, dispatched, columnWindow } = createInitializedReview(() => pending.promise);
        const editor = createSourceEditor("abc");
        const { panel } = createReviewPanel(["fixed2", "fixed3"]);

        const reviewing = review.Review("abc", panel, columnWindow, editor);
        change(editor);
        pending.resolve(TWO_INDICATIONS);
        await reviewing;

        assert.match(panel.html, /もう一度校正してください/);
        assert.doesNotMatch(panel.html, /opd_text_review_apply_selected/);
        assert.equal(dispatched.length, 0);
    });
}

for (const [name, change] of [
    ["text is edited", (editor) => { editor.innerText = "abc added"; }],
    ["editor is removed", (editor) => { editor.isConnected = false; }],
    ["editor is reviewed again", (editor) => { editor.setAttribute("opd_text_review_source", "newer"); }],
]) {
    test(`apply buttons refuse a shown result after the ${name}`, async () => {
        const { review, dispatched, columnWindow } = createInitializedReview(async () => TWO_INDICATIONS);
        const editor = createSourceEditor("abc");
        const { panel, checkboxes, listeners } = createReviewPanel(["fixed2", "fixed3"]);
        await review.Review("abc", panel, columnWindow, editor);
        checkboxes.get("fixed2").click();

        change(editor);
        listeners.get("selected:click")({});
        assert.equal(dispatched.length, 0);
        assert.match(panel.html, /もう一度校正してください/);

        listeners.get("all:click")({});
        assert.equal(dispatched.length, 0);
        assert.equal(checkboxes.get("fixed3").checked, false);
    });
}

//text_review_helper.js をページ側と同じく読み込み、focusin と適用イベントを直接送る
function createHelper() {
    const documentListeners = new Map();
    const windowListeners = new Map();
    const timers = [];
    const window = {
        addEventListener(type, callback) { windowListeners.set(type, callback); },
        getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    };
    const document = {
        defaultView: window,
        querySelector: (selector) => selector === "head" ? { insertAdjacentHTML() {} } : null,
        getElementById: () => null,
        createRange: () => ({ selectNodeContents() {} }),
        addEventListener(type, callback) { documentListeners.set(type, callback); },
    };
    const context = {
        window,
        document,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        MutationObserver: class { observe() {} disconnect() {} },
        //選択待ちの setTimeout はテストから進める
        setTimeout(callback) { timers.push(callback); return timers.length; },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/text_review_helper.js", "utf8"), context);
    windowListeners.get("opd_text_review_init")({ detail: JSON.stringify({ token: "token" }) });

    //Draft.js の EditorState 相当。setEditorText が作る新しい状態の本文を記録する
    class ContentState {
        constructor(text) { this.text = text; }
        static createFromText(text) { return new ContentState(text); }
    }
    class EditorState {
        constructor(text) { this.text = text; }
        static moveFocusToEnd(state) { return state; }
        static createWithContent(content) { return new EditorState(content.text); }
        getCurrentContent() { return new ContentState(this.text); }
        getDecorator() { return null; }
    }

    function createEditor(text, sourceId) {
        const editor = createSourceEditor(text);
        editor.setAttribute("opd_text_review_source", sourceId);
        editor.ownerDocument = document;
        editor.focus = () => {};
        editor.applied = [];
        editor["__reactProps$test"] = {
            children: { props: { editor: {
                _latestEditorState: new EditorState(text),
                props: { onChange(state) { editor.applied.push(state.text); } },
            } } },
        };
        return editor;
    }

    return {
        createEditor,
        focus(editor) { documentListeners.get("focusin")({ target: editor }); },
        apply(detail) {
            return windowListeners.get("opd_text_review_apply")({
                detail: JSON.stringify({ token: "token", is_firefox: true, ...detail }),
            });
        },
        flushTimers() { timers.splice(0).forEach((callback) => callback()); },
    };
}

async function applyWithHelper(helper, detail) {
    const applying = helper.apply(detail);
    //選択待ちに入っていれば待機を解く(入口で拒否されていれば何もしない)
    helper.flushTimers();
    await applying;
}

const SOURCE_DETAIL = { text: "aBC", source_text: "abc", source_id: "source" };

test("helper replaces the focused editor when the source text and editor match", async () => {
    const helper = createHelper();
    const editor = helper.createEditor("abc", "source");
    helper.focus(editor);

    await applyWithHelper(helper, SOURCE_DETAIL);
    assert.deepEqual(editor.applied, ["aBC"]);
});

test("helper refuses stale text, other focused editors, removed editors, and missing source data", async () => {
    const helper = createHelper();
    const editor = helper.createEditor("abc", "source");
    const other = helper.createEditor("abc", "other");
    helper.focus(editor);

    editor.innerText = "abc added";
    await applyWithHelper(helper, SOURCE_DETAIL);
    editor.innerText = "abc";

    await applyWithHelper(helper, { text: "aBC" });

    helper.focus(other);
    await applyWithHelper(helper, SOURCE_DETAIL);
    assert.deepEqual(other.applied, []);

    helper.focus(editor);
    editor.isConnected = false;
    await applyWithHelper(helper, SOURCE_DETAIL);
    assert.deepEqual(editor.applied, []);
});

test("helper refuses when the text changes while waiting for the selection", async () => {
    const helper = createHelper();
    const editor = helper.createEditor("abc", "source");
    helper.focus(editor);

    const applying = helper.apply(SOURCE_DETAIL);
    editor.innerText = "abc added";
    helper.flushTimers();
    await applying;
    assert.deepEqual(editor.applied, []);
});
