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

test("settings codec imports old/new formats and rejects malformed state", () => {
    const context = { window: {} };
    loadScript("extensions/custom/settings_codec.js", context);
    const codec = context.window.opd_custom_settings_codec;

    const decoded = codec.decode({
        format: codec.FORMAT,
        schema_version: codec.SCHEMA_VERSION,
        opd_settings: { last_load_profile: 1, version: "1.1.3.7" },
        opd_profile_store: profileStore,
        opd_custom_column_state: { "0:0": "Following" }
    });
    const items = codec.build_storage_items(decoded, null, "1.1.3.7");
    assert.equal(JSON.parse(items.opd_settings).last_load_profile, 0);
    assert.equal(JSON.parse(items.opd_custom_column_state)["0:0"], "Following");
    assert.equal(codec.create_export(items).schema_version, 1);
    assert.equal(codec.decode({ row_settings: profileStore[0].profile }).profile_store[0].name, "default");

    assert.throws(() => codec.decode({ opd_profile_store: "{broken" }));
    assert.throws(() => codec.decode([{ name: "bad", profile: [{ type: "unknown" }] }]));
    assert.throws(() => codec.decode({ opd_profile_store: profileStore, opd_custom_column_state: { bad: "x" } }));
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
    loadScript("extensions/custom/column_state.js", context);
    const state = context.window.opd_custom_column_state;
    const call = (operation) => new Promise((resolve) => operation(resolve));

    await Promise.all([
        call((done) => state.save_tab(0, 0, "Following", done)),
        call((done) => state.save_tab(0, 1, "List", done)),
        call((done) => state.copy_profile(0, 1, done))
    ]);
    await call((done) => state.delete_profile(0, done));

    assert.deepEqual(JSON.parse(stored), { "0:0": "Following", "0:1": "List" });
});

test("column reorder remaps selections through the serialized mutation path", () => {
    let state = { "0:0": "Following", "0:1": "List", "1:0": "Other" };
    const sectionA = { id: "A" };
    const sectionB = { id: "B" };
    const context = {
        window: { opd_custom_column_state: {
            get_profile_index: (callback) => callback(0),
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
