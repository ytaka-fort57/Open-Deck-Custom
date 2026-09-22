import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = process.cwd();
const excludedDirectories = new Set([
    ".git", ".agents", ".claude", ".firefox-dev", "package", "package_tmp", "node_modules"
]);

function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return excludedDirectories.has(entry.name) ? [] : walk(path);
        }
        return [path];
    });
}

function manifestReferences(manifest) {
    const references = [
        ...Object.values(manifest.icons ?? {}),
        manifest.background?.service_worker,
        ...(manifest.background?.scripts ?? []),
        manifest.action?.default_popup,
        typeof manifest.action?.default_icon === "string" ? manifest.action.default_icon : null,
        manifest.browser_action?.default_popup,
        typeof manifest.browser_action?.default_icon === "string" ? manifest.browser_action.default_icon : null
    ];
    for (const contentScript of manifest.content_scripts ?? []) {
        references.push(...(contentScript.js ?? []), ...(contentScript.css ?? []));
    }
    for (const resource of manifest.web_accessible_resources ?? []) {
        references.push(...(typeof resource === "string" ? [resource] : (resource.resources ?? [])));
    }
    return references.filter(Boolean);
}

// Chromium (MV3) は [{matches, resources}]、Firefox (MV2) は文字列配列で宣言するため、
// 両形式を resources の平坦な配列へ揃える。
function webAccessibleResources(manifest) {
    return (manifest.web_accessible_resources ?? []).flatMap((resource) => (
        typeof resource === "string" ? [resource] : (resource.resources ?? [])
    ));
}

test("all project JavaScript files pass node --check", () => {
    const files = walk(root).filter((path) => path.endsWith(".js") || path.endsWith(".mjs"));
    for (const file of files) {
        const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
        assert.equal(result.status, 0, `${relative(root, file)}\n${result.stderr}`);
    }
});

test("manifests and locale files are valid and complete", () => {
    for (const manifestName of ["manifest.json", "manifest_firefox.json"]) {
        const manifest = JSON.parse(readFileSync(join(root, manifestName), "utf8"));
        for (const reference of manifestReferences(manifest)) {
            assert.ok(existsSync(join(root, reference)), `${manifestName}: missing ${reference}`);
        }
    }

    const ja = JSON.parse(readFileSync(join(root, "_locales/ja/messages.json"), "utf8"));
    const en = JSON.parse(readFileSync(join(root, "_locales/en/messages.json"), "utf8"));
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());

    const importHtml = readFileSync(join(root, "extensions/custom/settings_import.html"), "utf8");
    assert.match(importHtml, /<script src="safe_values\.js"/);
    assert.match(importHtml, /<script src="column_state_migration\.js"/);
    assert.match(importHtml, /<script src="settings_codec\.js"/);
    //移行モジュールは settings_codec より前に読み込まれていなければ undefined を参照する
    assert.ok(
        importHtml.indexOf('src="column_state_migration.js"') < importHtml.indexOf('src="settings_codec.js"'),
        "settings_import.html: column_state_migration.js must load first"
    );
    assert.match(importHtml, /<script src="storage_repository\.js"/);

    for (const manifestName of ["manifest.json", "manifest_firefox.json"]) {
        const manifest = JSON.parse(readFileSync(join(root, manifestName), "utf8"));
        const scripts = manifest.content_scripts[0].js;
        assert.ok(scripts.indexOf("extensions/custom/safe_values.js") < scripts.indexOf("content.js"));
        assert.ok(scripts.indexOf("extensions/custom/storage_repository.js") < scripts.indexOf("content.js"));
        assert.ok(scripts.indexOf("extensions/custom/column_settings.js") < scripts.indexOf("content.js"));
        assert.ok(scripts.indexOf("extensions/custom/column_state_migration.js") < scripts.indexOf("extensions/custom/column_settings.js"));
        assert.ok(scripts.indexOf("extensions/custom/column_state_migration.js") < scripts.indexOf("extensions/custom/column_state.js"));
        assert.ok(scripts.indexOf("extensions/custom/column_dom.js") < scripts.indexOf("content.js"));
        assert.ok(scripts.indexOf("extensions/custom/text_review_model.js") < scripts.indexOf("extensions/text_review.js"));
        assert.ok(scripts.indexOf("extensions/custom/column_dom.js") < scripts.indexOf("extensions/custom/column_frame_css.js"));
        assert.ok(scripts.indexOf("extensions/custom/column_frame_css.js") < scripts.indexOf("content.js"));
        //lifecycle は3モジュールの合成点なので、合成される側が先に読み込まれていなければ undefined を参照する
        for (const source of [
            "extensions/custom/column_resource_registry.js",
            "extensions/custom/page_event_lifecycle.js",
            "extensions/custom/page_observer_lifecycle.js",
        ]) {
            assert.ok(
                scripts.indexOf(source) >= 0
                && scripts.indexOf(source) < scripts.indexOf("extensions/custom/lifecycle.js"),
                `${manifestName}: ${source}`
            );
        }
    }

    const upstreamBase = readFileSync(join(root, ".github/upstream-base"), "utf8").trim();
    assert.match(upstreamBase, /^[0-9a-f]{40}$/);
    const upstreamWorkflow = readFileSync(join(root, ".github/workflows/sync-upstream.yml"), "utf8");
    assert.match(upstreamWorkflow, /issues: write/);
    assert.match(upstreamWorkflow, /gh issue (create|edit)/);
    assert.doesNotMatch(upstreamWorkflow, /\bgit merge(?:\s|$)|\bgit push(?:\s|$)|\bgh pr(?:\s|$)/m);
});

test("content.js column templates take their labels from _locales", () => {
    const content = readFileSync(join(root, "content.js"), "utf8");
    assert.match(content, /let default_element = window\.opd_custom_column_template\.build\(i18n_message,/);

    //テンプレートは文言をすべて t() から受け取り、日本語を直書きしない。
    const templateFile = "extensions/custom/column_template.js";
    const templateSource = readFileSync(join(root, templateFile), "utf8");
    const code = templateSource.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /[぀-ゟ゠-ヿ一-鿿]/);
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(templateSource, context);
    const used = new Set();
    const built = context.window.opd_custom_column_template.build(
        (key) => { used.add(key); return `[${key}]`; },
        (path) => path,
        { column_add_1: "a.svg", column_add_2: "b.svg" }
    );
    assert.doesNotMatch(Object.values(built).map((item) => item.html).join(""), /[぀-ゟ゠-ヿ一-鿿]/);
    for (const key of [
        "ui_column_close_title", "ui_column_pin_toggle_title", "ui_column_post_title",
        "ui_column_timeline_title", "ui_column_notifications_title", "ui_column_explore_title",
        "ui_empty_column_message", "ui_second_empty_column_message"
    ]) {
        assert.ok(used.has(key), `${templateFile}: missing ${key}`);
    }

    const ja = JSON.parse(readFileSync(join(root, "_locales/ja/messages.json"), "utf8"));
    for (const key of used) {
        assert.ok(key in ja, `${templateFile}: missing locale key ${key}`);
    }
    for (const file of ["extensions/custom/column_reorder.js", "extensions/custom/index.js"]) {
        const source = readFileSync(join(root, file), "utf8");
        const keys = [...source.matchAll(/chrome\.i18n\.getMessage\("([^"]+)"\)/g)].map((m) => m[1]);
        assert.ok(keys.length > 0, `${file}: no i18n keys`);
        for (const key of keys) {
            assert.ok(key in ja, `${file}: missing locale key ${key}`);
        }
    }
});

test("content scripts and web accessible resources match between manifests", () => {
    const chromium = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    const firefox = JSON.parse(readFileSync(join(root, "manifest_firefox.json"), "utf8"));

    // content script は読み込み順に依存するため、集合ではなく順序込みで比較する。
    assert.deepEqual(
        firefox.content_scripts[0].js,
        chromium.content_scripts[0].js,
        "manifest_firefox.json: content_scripts[0].js differs from manifest.json"
    );

    const chromiumResources = webAccessibleResources(chromium);
    const firefoxResources = webAccessibleResources(firefox);
    assert.deepEqual(
        [...new Set(firefoxResources)].sort(),
        [...new Set(chromiumResources)].sort(),
        "manifest_firefox.json: web_accessible_resources differs from manifest.json"
    );
});

test("deck CSS is packaged and loaded as a web-accessible stylesheet", () => {
    const content = readFileSync(join(root, "content.js"), "utf8");
    assert.match(content, /<link rel="stylesheet" href="\$\{chrome\.runtime\.getURL\("deck\.css"\)\}">/);
    assert.doesNotMatch(content, /opd_default_css/);
    for (const manifestName of ["manifest.json", "manifest_firefox.json"]) {
        const manifest = JSON.parse(readFileSync(join(root, manifestName), "utf8"));
        assert.ok(webAccessibleResources(manifest).includes("deck.css"), `${manifestName}: missing deck.css`);
    }
});
