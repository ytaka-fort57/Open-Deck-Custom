import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadScript(path, context) {
    vm.createContext(context);
    vm.runInContext(readFileSync(path, "utf8"), context);
}

const profileStore = [{
    name: "default",
    profile: [
        { type: "main_bar_empty_column" },
        { type: "home", auto_reload_time: 10000 },
        { type: "explore", column_save_path: "/explore" },
        { type: "empty_column" }
    ]
}];

const CODEC_SOURCES = [
    "extensions/custom/safe_values.js",
    "extensions/custom/column_state_migration.js",
    "extensions/custom/settings_codec.js",
    "extensions/custom/column_settings.js",
];

test("settings codec imports old/new formats and rejects malformed state", () => {
    const context = { window: {}, URL };
    for (const file of CODEC_SOURCES) {
        loadScript(file, context);
    }
    const codec = context.window.opd_custom_settings_codec;
    const columnSettings = context.window.opd_custom_column_settings;

    const decoded = codec.decode({
        format: codec.FORMAT,
        schema_version: codec.SCHEMA_VERSION,
        opd_settings: { last_load_profile: 1, version: "1.1.3.7" },
        opd_profile_store: profileStore,
        opd_custom_column_state: { "0:0": "Following" }
    });
    const items = codec.build_storage_items(decoded, null, "1.1.3.7");
    assert.equal(JSON.parse(items.opd_settings).last_load_profile, 0);
    //version 1 の書き出しは読み込み時に安定ID鍵へ移る。"0:0" は1本目のタイムラインカラムを指す
    const timeline_uid = decoded.profile_store[0].profile[1].opd_custom_uid;
    assert.match(timeline_uid, /^[0-9A-Za-z_-]+$/);
    assert.deepEqual(JSON.parse(items.opd_custom_column_state), {
        schema_version: 2,
        tabs: { [`0:${timeline_uid}`]: "Following" },
    });
    assert.equal(codec.create_export(items).schema_version, 2);
    //version 2 は読み直しても鍵もIDも変わらない
    const reexported = codec.create_export(codec.build_storage_items(
        codec.decode(codec.create_export(items)), null, "1.1.3.7"
    ));
    assert.deepEqual(JSON.parse(JSON.stringify(reexported.opd_custom_column_state)), {
        schema_version: 2,
        tabs: { [`0:${timeline_uid}`]: "Following" },
    });
    assert.equal(reexported.opd_profile_store[0].profile[1].opd_custom_uid, timeline_uid);
    assert.equal(codec.decode({ row_settings: profileStore[0].profile }).profile_store[0].name, "default");

    const legacy_profile_store = [{
        name: "legacy",
        profile: [{
            type: "explore",
            column_save_path: "/explore",
            column_save_title: null,
            column_width: 42,
            future_option: "keep-me",
        }],
    }];
    const legacy_decoded = codec.decode(legacy_profile_store);
    const legacy_column = legacy_decoded.profile_store[0].profile[0];
    //IDを持たない古い書き出しは読み込み時に発行される
    assert.match(legacy_column.opd_custom_uid, /^[0-9A-Za-z_-]+$/);
    assert.equal(legacy_column.column_save_title, "");
    assert.equal(legacy_column.column_width, "42");
    assert.equal(legacy_column.future_option, "keep-me");
    assert.deepEqual(
        JSON.parse(JSON.stringify(columnSettings.normalize(legacy_column))),
        {
            type: "explore",
            opd_custom_uid: legacy_column.opd_custom_uid,
            banner: false,
            top_visible: false,
            tw_view_mode: "0",
            column_save_path: "/explore",
            column_save_title: "",
            column_pinned_path: "",
            auto_reload: false,
            auto_reload_time: 10000,
            column_width: "42",
        }
    );
    const exported_legacy = codec.create_export({
        opd_profile_store: JSON.stringify(legacy_profile_store),
        opd_settings: null,
        opd_custom_column_state: null,
    });
    assert.equal(exported_legacy.opd_profile_store[0].profile[0].column_save_title, "");
    assert.equal(exported_legacy.opd_profile_store[0].profile[0].column_width, "42");
    assert.equal(exported_legacy.opd_profile_store[0].profile[0].future_option, "keep-me");

    assert.throws(() => codec.decode({ opd_profile_store: "{broken" }));
    assert.throws(() => codec.decode([{ name: "bad", profile: [{ type: "unknown" }] }]));
    assert.throws(() => codec.decode({ opd_profile_store: profileStore, opd_custom_column_state: { bad: "x" } }));
    //version 2 は {schema_version, tabs} 以外の項目を受け付けない
    assert.throws(() => codec.decode({
        opd_profile_store: profileStore,
        opd_custom_column_state: { schema_version: 2, tabs: { "0:a": "x" }, extra: 1 },
    }));
    assert.throws(() => codec.decode({
        opd_profile_store: profileStore,
        opd_custom_column_state: { schema_version: 2, tabs: { "nope": "x" } },
    }));
    assert.throws(() => codec.decode([{ name: "bad path", profile: [{ type: "explore", column_save_path: "//evil.example" }] }]));
    assert.throws(() => codec.decode([{ name: "bad text", profile: [{ type: "home", column_save_title: "bad\u0000title" }] }]));
});

test("column state serializes concurrent writes and profile remapping", async () => {
    let stored = "{}";
    const context = {
        window: {},
        document: { querySelector: () => ({ textContent: "0" }) },
        chrome: {
            runtime: { id: "test" },
            storage: { local: {
                get: (keys, callback) => setTimeout(() => callback({ opd_custom_column_state: stored }), 1),
                set: (items, callback) => setTimeout(() => {
                    stored = items.opd_custom_column_state;
                    callback();
                }, 1)
            } }
        },
        setTimeout
    };
    loadScript("extensions/custom/storage_repository.js", context);
    loadScript("extensions/custom/column_state_migration.js", context);
    loadScript("extensions/custom/column_state.js", context);
    const state = context.window.opd_custom_column_state;
    const call = (operation) => new Promise((resolve) => operation(resolve));

    await Promise.all([
        call((done) => state.save_tab(0, 0, "Following", done)),
        call((done) => state.save_tab(0, 1, "List", done)),
        call((done) => state.copy_profile(0, 1, null, done))
    ]);
    await call((done) => state.delete_profile(0, done));

    assert.deepEqual(JSON.parse(stored), { "0:0": "Following", "0:1": "List" });
});

test("storage repository preserves concurrent JSON mutations and atomic multi-key writes", async () => {
    const stored = { opd_custom_column_state: "{}" };
    const setCalls = [];
    const context = {
        window: {},
        chrome: {
            runtime: { id: "test", lastError: null },
            storage: { local: {
                get: (keys, callback) => setTimeout(() => {
                    const requested = Array.isArray(keys) ? keys : [keys];
                    callback(Object.fromEntries(requested.map((key) => [key, stored[key]])));
                }, 1),
                set: (items, callback) => setTimeout(() => {
                    Object.assign(stored, items);
                    setCalls.push(Object.assign({}, items));
                    callback();
                }, 1),
                remove: (keys, callback) => {
                    for(const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
                    callback();
                },
            } },
        },
        setTimeout,
    };
    loadScript("extensions/custom/storage_repository.js", context);
    const repository = context.window.opd_custom_storage;
    const update = (mutator) => new Promise((resolve, reject) => {
        repository.update_json(repository.KEYS.COLUMN_STATE, {}, mutator, (error) => {
            if(error) reject(error); else resolve();
        });
    });

    await Promise.all([
        update((state) => Object.assign(state, { "0:0": "Following" })),
        update((state) => Object.assign(state, { "0:1": "List" })),
    ]);
    assert.deepEqual(JSON.parse(stored.opd_custom_column_state), { "0:0": "Following", "0:1": "List" });

    await new Promise((resolve, reject) => {
        repository.set_json_many({ opd_settings: { last_load_profile: 0 }, opd_profile_store: [] }, (error) => {
            if(error) reject(error); else resolve();
        });
    });
    assert.deepEqual(Object.keys(setCalls.at(-1)).sort(), ["opd_profile_store", "opd_settings"]);

    stored.opd_settings = "{broken";
    await new Promise((resolve) => {
        repository.get_json(repository.KEYS.SETTINGS, null, (error, value) => {
            assert.match(error.message, /opd_settings/);
            assert.equal(value, null);
            resolve();
        });
    });

    stored.opd_settings = JSON.stringify({});
    //複数キーのread-modify-writeは1つのキュー項目で行う。間に入った書き込みを取りこぼさない
    const manyUpdate = (mutator) => new Promise((resolve, reject) => {
        repository.update_json_many(
            { opd_settings: {}, opd_profile_store: [] },
            mutator,
            (error) => { if(error) reject(error); else resolve(); }
        );
    });
    await Promise.all([
        manyUpdate((values) => ({
            opd_settings: Object.assign(values.opd_settings, { last_load_profile: 2 }),
            opd_profile_store: values.opd_profile_store.concat([{ name: "first" }]),
        })),
        manyUpdate((values) => ({
            opd_settings: Object.assign(values.opd_settings, { version: "9.9" }),
            opd_profile_store: values.opd_profile_store.concat([{ name: "second" }]),
        })),
    ]);
    assert.deepEqual(JSON.parse(stored.opd_settings), { last_load_profile: 2, version: "9.9" });
    assert.deepEqual(
        JSON.parse(stored.opd_profile_store).map((profile) => profile.name),
        ["first", "second"]
    );
    //NO_CHANGE は読んだ値をそのまま返し、書き込みを起こさない
    const writesBefore = setCalls.length;
    await manyUpdate(() => repository.NO_CHANGE);
    assert.equal(setCalls.length, writesBefore);

    await assert.rejects(
        manyUpdate(() => undefined),
        /更新関数が値を返しませんでした/
    );
    await assert.rejects(
        update(() => undefined),
        /更新関数が値を返しませんでした/
    );
    await update((state) => Object.assign(state, { "0:2": "After error" }));
    assert.equal(JSON.parse(stored.opd_custom_column_state)["0:2"], "After error");
});

test("column reorder remaps selections through the serialized mutation path", () => {
    let state = { "0:0": "Following", "0:1": "List", "1:0": "Other" };
    const sectionA = { id: "A" };
    const sectionB = { id: "B" };
    const context = {
        window: { opd_custom_column_state: {
            get_profile_index: (callback) => callback(0),
            is_stable_id_mode: () => false,
            update_all: (mutator) => { state = mutator(state); }
        } }
    };
    loadScript("extensions/custom/column_reorder.js", context);
    const document = { querySelectorAll: () => [
        { closest: () => sectionB },
        { closest: () => sectionA }
    ] };

    context.window.opd_custom_column_reorder.remap_after_dom_change([sectionA, sectionB], document);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), {
        "0:0": "List",
        "0:1": "Following",
        "1:0": "Other"
    });
});
