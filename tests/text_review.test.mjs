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

test("review UI keeps selection and apply communication wired to the pure model", async () => {
    const { review, document } = createReview(async () => false);
    review.Init(
        { contentWindow: { document, location: { pathname: "/" } } },
        { text_review: "text.svg", hashtag_restore: "tag.svg" },
        "ja"
    );
    assert.equal(review.opd_text_review_token, "token");
    let nextId = 0;
    review.CreateRandomID = () => `fixed${++nextId}`;
    review.ReviewRquest = async () => ({
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
    });

    const listeners = new Map();
    const checkboxes = new Map(["fixed1", "fixed2"].map(id => [id, {
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
        textContent: "",
        html: "",
        insertAdjacentHTML(position, html) { this.html += html; },
        querySelector(selector) {
            const checkboxId = /^#opd_text_review_iid_(fixed[12])$/.exec(selector)?.[1];
            if(checkboxId) return checkboxes.get(checkboxId);
            if(/^#opd_text_review_problem_id_fixed[12]$/.test(selector)) return problem;
            if(selector === "#opd_text_review_apply_selected") return selectedButton;
            if(selector === "#opd_text_review_apply_all") return allButton;
            return null;
        },
    };
    const dispatched = [];
    const columnWindow = { document: { dispatchEvent(event) { dispatched.push(event); } } };

    await review.Review("abc", panel, columnWindow);
    assert.match(panel.html, /opd_text_review_problem_id_fixed1/);
    checkboxes.get("fixed1").click();
    listeners.get("selected:click")({});
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, "opd_text_review_apply");
    assert.deepEqual(JSON.parse(dispatched[0].detail), {
        text: "aBc",
        token: "token",
        is_firefox: false,
    });
    listeners.get("all:click")({});
    assert.equal(dispatched.length, 2);
    assert.equal(checkboxes.get("fixed1").checked, true);
    assert.equal(checkboxes.get("fixed2").checked, true);
    assert.deepEqual(JSON.parse(dispatched[1].detail), {
        text: "aBC",
        token: "token",
        is_firefox: false,
    });
});
