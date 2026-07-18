import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

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
    assert.match(importHtml, /<script src="settings_codec\.js"/);
    assert.match(importHtml, /<script src="storage_repository\.js"/);

    for (const manifestName of ["manifest.json", "manifest_firefox.json"]) {
        const manifest = JSON.parse(readFileSync(join(root, manifestName), "utf8"));
        const scripts = manifest.content_scripts[0].js;
        assert.ok(scripts.indexOf("extensions/custom/storage_repository.js") < scripts.indexOf("content.js"));
    }
});
