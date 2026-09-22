import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadScript(path, context) {
    vm.createContext(context);
    vm.runInContext(readFileSync(path, "utf8"), context);
}

//vmの外とはプロトタイプが違うため、比べる前に素のオブジェクトへ写す
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadMigration() {
    const context = { window: {} };
    loadScript("extensions/custom/column_state_migration.js", context);
    return context.window.opd_custom_column_state_migration;
}

//カラム設定・タブ保存を持つデッキ全体を、storageに入っているままの形で作る
function profileStore(...profiles) {
    return profiles.map((columns, index) => ({ name: `p${index}`, profile: columns }));
}

function sequentialIds() {
    let next = 0;
    return () => `id${++next}`;
}

function loadColumnState({ profile_store, column_state, failWrite = false }) {
    const stored = {
        opd_profile_store: JSON.stringify(profile_store),
        opd_custom_column_state: JSON.stringify(column_state),
    };
    const context = {
        window: {},
        console: { error: () => {} },
        document: { querySelector: () => ({ textContent: "0" }) },
        chrome: {
            runtime: { id: "test", lastError: null },
            storage: {
                local: {
                    get: (keys, callback) => setTimeout(() => {
                        const requested = Array.isArray(keys) ? keys : [keys];
                        callback(Object.fromEntries(requested.map((key) => [key, stored[key]])));
                    }, 1),
                    set: (items, callback) => setTimeout(() => {
                        if (failWrite) {
                            context.chrome.runtime.lastError = { message: "storage is full" };
                            callback();
                            context.chrome.runtime.lastError = null;
                            return;
                        }
                        Object.assign(stored, items);
                        callback();
                    }, 1),
                },
            },
        },
        setTimeout,
    };
    loadScript("extensions/custom/storage_repository.js", context);
    loadScript("extensions/custom/column_state_migration.js", context);
    loadScript("extensions/custom/column_state.js", context);
    return { state: context.window.opd_custom_column_state, stored };
}

const read = (stored, key) => JSON.parse(stored[key]);

test("position keys are read as the timeline-only index they always were", () => {
    const migration = loadMigration();
    //旧鍵の添字は、通知やExploreを挟んでいてもタイムラインカラムだけの連番である
    const store = profileStore([
        { type: "main_bar_empty_column" },
        { type: "home" },
        { type: "notification" },
        { type: "home" },
        { type: "explore", column_save_path: "/explore" },
        { type: "empty_column" },
        { type: "home" },
    ]);
    const result = migration.migrate(store, { "0:0": "Following", "0:2": "List", "0:9": "Gone" }, sequentialIds());

    const uids = result.profile_store[0].profile.map((column) => column.opd_custom_uid);
    assert.equal(new Set(uids).size, uids.length, "IDはプロファイル内で重複しない");
    assert.deepEqual(plain(result.column_state), {
        schema_version: 2,
        tabs: { [`0:${uids[1]}`]: "Following", [`0:${uids[6]}`]: "List" },
    });
    //カラム数より大きい添字は削除済みカラムの残骸なので捨てる
    assert.equal(Object.keys(result.column_state.tabs).length, 2);
});

test("migration is idempotent and leaves an already migrated state untouched", () => {
    const migration = loadMigration();
    const store = profileStore([{ type: "home" }]);
    const once = migration.migrate(store, { "0:0": "Following" }, sequentialIds());
    const twice = migration.migrate(once.profile_store, once.column_state, sequentialIds());

    assert.equal(once.changed, true);
    assert.equal(twice.changed, false);
    assert.deepEqual(plain(twice.column_state), plain(once.column_state));
    assert.deepEqual(plain(twice.profile_store), plain(once.profile_store));
});

test("an unreadable profile store leaves the old state in place instead of dropping tabs", () => {
    const migration = loadMigration();
    //IDを配れない以上、読み替えた鍵はどのカラムも指さない。旧形式のまま残すほうが安全
    for (const broken of [null, undefined, [], {}, [{ name: "x" }]]) {
        const result = migration.migrate(broken, { "0:0": "Following" }, sequentialIds());
        assert.equal(result.migrated, false);
        assert.equal(result.changed, false);
        assert.deepEqual(plain(result.column_state), { "0:0": "Following" });
    }
});

test("each profile keeps its own tabs and numbering through the migration", () => {
    const migration = loadMigration();
    const store = profileStore([{ type: "home" }], [{ type: "home" }, { type: "home" }]);
    const result = migration.migrate(store, { "0:0": "A", "1:1": "B", "2:0": "Dropped" }, sequentialIds());
    const uid = (profile, index) => result.profile_store[profile].profile[index].opd_custom_uid;

    assert.deepEqual(plain(result.column_state.tabs), { [`0:${uid(0, 0)}`]: "A", [`1:${uid(1, 1)}`]: "B" });
});

test("stable ids survive a round trip and duplicates are re-issued", () => {
    const migration = loadMigration();
    const assigned = migration.assign_uids([
        { type: "home", opd_custom_uid: "kept" },
        { type: "home" },
        //保存が壊れて同じIDが2度出てきた場合、後に出たほうを振り直す
        { type: "home", opd_custom_uid: "kept" },
    ], sequentialIds());

    assert.deepEqual(plain(assigned.map((column) => column.opd_custom_uid)), ["kept", "id1", "id2"]);
    //発行器が同じ値しか返さなくても重複させない
    assert.deepEqual(
        plain(migration.assign_uids([{ type: "home" }, { type: "home" }], () => "same")
            .map((column) => column.opd_custom_uid)),
        ["same", "uid0"]
    );
});

test("copying a profile re-issues every id and reports the mapping", () => {
    const migration = loadMigration();
    const { profile, uid_map } = migration.reissue_uids(
        [{ type: "home", opd_custom_uid: "a" }, { type: "home", opd_custom_uid: "b" }],
        sequentialIds()
    );

    assert.deepEqual(plain(profile.map((column) => column.opd_custom_uid)), ["id1", "id2"]);
    assert.deepEqual(plain(uid_map), { a: "id1", b: "id2" });
});

test("the deck migrates once, keeps the old value and then saves by stable id", async () => {
    const { state, stored } = loadColumnState({
        profile_store: profileStore([{ type: "main_bar_empty_column" }, { type: "home" }, { type: "home" }]),
        column_state: { "0:1": "List" },
    });
    assert.equal(state.is_stable_id_mode(), false);

    const migrated_store = await new Promise((resolve) => state.ensure_migrated(sequentialIds(), resolve));
    assert.equal(state.is_stable_id_mode(), true);
    const uid = migrated_store[0].profile[2].opd_custom_uid;
    assert.deepEqual(read(stored, "opd_custom_column_state"), {
        schema_version: 2,
        tabs: { [`0:${uid}`]: "List" },
    });
    //版を戻すときに手で書き戻せるよう、移行前の保存をそのまま残す
    assert.deepEqual(read(stored, "opd_custom_column_state_v1"), { "0:1": "List" });
    assert.equal(read(stored, "opd_profile_store")[0].profile[2].opd_custom_uid, uid);

    //移行後の書き込みは包みを保ったまま行う
    await new Promise((resolve) => state.save_tab(0, uid, "Following", resolve));
    assert.deepEqual(read(stored, "opd_custom_column_state"), {
        schema_version: 2,
        tabs: { [`0:${uid}`]: "Following" },
    });
    const label = await new Promise((resolve) => state.get_tab(0, uid, resolve));
    assert.equal(label, "Following");

    //2度目の起動では何も書き換えない
    const second = await new Promise((resolve) => state.ensure_migrated(sequentialIds(), resolve));
    assert.equal(second, null);
    assert.deepEqual(read(stored, "opd_custom_column_state_v1"), { "0:1": "List" });
});

test("a failed migration writes nothing and keeps the position key path alive", async () => {
    const { state, stored } = loadColumnState({
        profile_store: profileStore([{ type: "home" }]),
        column_state: { "0:0": "List" },
        failWrite: true,
    });

    const result = await new Promise((resolve) => state.ensure_migrated(sequentialIds(), resolve));
    assert.equal(result, null);
    assert.equal(state.is_stable_id_mode(), false);
    assert.deepEqual(read(stored, "opd_custom_column_state"), { "0:0": "List" });
    assert.equal(stored.opd_custom_column_state_v1, undefined);
    //位置キーのまま読める
    assert.equal(await new Promise((resolve) => state.get_tab(0, 0, resolve)), "List");
});

test("the key mode settles even when nothing runs the migration", async () => {
    const { state } = loadColumnState({
        profile_store: profileStore([{ type: "home" }]),
        column_state: { schema_version: 2, tabs: { "0:abc": "List" } },
    });

    await new Promise((resolve) => state.when_ready(resolve));
    assert.equal(state.is_stable_id_mode(), true);
    //安定IDの起動では鍵はカラムの属性から、位置キーの起動では表示位置から取る
    assert.equal(state.column_key({ getAttribute: () => "abc" }, 3), "abc");
    assert.equal(state.column_key({ getAttribute: () => null }, 3), null);
});

test("profile copy and delete follow the stable id keys", async () => {
    const { state, stored } = loadColumnState({
        profile_store: profileStore([{ type: "home" }]),
        column_state: { schema_version: 2, tabs: { "0:a": "Following", "0:b": "List", "1:z": "Stale" } },
    });
    await new Promise((resolve) => state.when_ready(resolve));

    //複製先のIDは振り直されるため、uid_map の対応だけを写す
    await new Promise((resolve) => state.copy_profile(0, 1, { a: "a2" }, resolve));
    assert.deepEqual(read(stored, "opd_custom_column_state"), {
        schema_version: 2,
        tabs: { "0:a": "Following", "0:b": "List", "1:a2": "Following" },
    });

    await new Promise((resolve) => state.delete_profile(0, resolve));
    assert.deepEqual(read(stored, "opd_custom_column_state"), {
        schema_version: 2,
        tabs: { "0:a2": "Following" },
    });
});
