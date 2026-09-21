import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class ScriptFixture {
    constructor() {
        this.src = null;
        this.listeners = [];
        this.appended_at = null;
    }

    addEventListener(name, callback) {
        assert.equal(name, "load");
        this.listeners.push(callback);
    }

    fireLoad() {
        this.listeners.forEach((callback) => callback());
    }
}

function loadInjector(tokens = ["token-1", "token-2"]) {
    const created = [];
    const dispatched = [];
    let appended = 0;
    const column_document = {
        createElement: (tag) => {
            assert.equal(tag, "script");
            const script = new ScriptFixture();
            created.push(script);
            return script;
        },
        head: {
            appendChild: (script) => {
                appended += 1;
                script.appended_at = appended;
            },
        },
        dispatchEvent: (event) => dispatched.push(event),
    };
    const remaining = [...tokens];
    const context = {
        window: {},
        chrome: { runtime: { getURL: (path) => `chrome-extension://opd/${path}` } },
        crypto: { randomUUID: () => remaining.shift() },
        CustomEvent: class {
            constructor(type, init) {
                this.type = type;
                Object.assign(this, init);
            }
        },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("extensions/custom/helper_injector.js", "utf8"), context);
    return {
        injector: context.window.opd_custom_helper_injector,
        column_window: { document: column_document },
        created,
        dispatched,
    };
}

test("inject resolves the helper URL and appends the script after the load listener", () => {
    const { injector, column_window, created } = loadInjector();

    const token = injector.inject(column_window, "extensions/utils_helper.js");

    assert.equal(created.length, 1);
    assert.equal(created[0].src, "chrome-extension://opd/extensions/utils_helper.js");
    assert.equal(created[0].appended_at, 1);
    //init イベント名を渡さない注入はトークンを発行せず、load リスナーも張らない
    assert.equal(token, null);
    assert.equal(created[0].listeners.length, 0);
});

test("inject sends a fresh token on load for every init event name", () => {
    const { injector, column_window, created, dispatched } = loadInjector(["uuid-a", "uuid-b"]);

    const reload_token = injector.inject(column_window, "extensions/auto_reload_helper.js", "opd_column_reload_init");
    const media_token = injector.inject(column_window, "extensions/media_viewer_block_helper.js", "opd_send_media_info_init");

    assert.equal(reload_token, "uuid-a");
    assert.equal(media_token, "uuid-b");
    assert.deepEqual(dispatched, [], "load 前は送らない");

    created.forEach((script) => script.fireLoad());

    assert.deepEqual(dispatched.map((event) => event.type), [
        "opd_column_reload_init", "opd_send_media_info_init",
    ]);
    for (const event of dispatched) {
        //helper 側は document / window どちらの capture リスナーでも受けるため形を揃える
        assert.equal(event.bubbles, true);
        assert.equal(event.composed, true);
    }
    assert.deepEqual(JSON.parse(dispatched[0].detail), { token: "uuid-a" });
    assert.deepEqual(JSON.parse(dispatched[1].detail), { token: "uuid-b" });
});

test("the four upstream helper classes inject through the shared function", () => {
    const sources = {
        "extensions/utils.js": null,
        "extensions/auto_reload.js": "opd_column_reload_init",
        "extensions/media_viewer_block.js": "opd_send_media_info_init",
        "extensions/text_review.js": "opd_text_review_init",
    };
    for (const [path, init_event] of Object.entries(sources)) {
        const source = readFileSync(path, "utf8");
        assert.match(source, /window\.opd_custom_helper_injector\.inject\(/, path);
        //注入手順の複製が残っていないこと
        assert.doesNotMatch(source, /createElement\('script'\)/, path);
        assert.doesNotMatch(source, /crypto\.randomUUID\(\)/, path);
        if (init_event) {
            assert.ok(source.includes(`'${init_event}'`), `${path}: ${init_event}`);
        }
    }

    for (const manifestName of ["manifest.json", "manifest_firefox.json"]) {
        const scripts = JSON.parse(readFileSync(manifestName, "utf8")).content_scripts[0].js;
        const injector_index = scripts.indexOf("extensions/custom/helper_injector.js");
        assert.ok(injector_index >= 0, manifestName);
        for (const path of Object.keys(sources)) {
            assert.ok(injector_index < scripts.indexOf(path), `${manifestName}: ${path}`);
        }
    }
});
