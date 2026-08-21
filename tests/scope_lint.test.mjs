import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { find_out_of_scope_calls } from "./scope_lint.mjs";

const root = process.cwd();
const excluded_directories = new Set([
    ".git", ".agents", ".claude", ".firefox-dev", "package", "package_tmp", "node_modules", "tests"
]);

function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return excluded_directories.has(entry.name) ? [] : walk(path);
        }
        return [path];
    });
}

test("scope lint detects a block-scoped function used outside its block", () => {
    const sample = `
        function handler(){
            if(target != null){
                const start_timer = function(){ return 1; };
                start_timer();
            }
            if(target != null){
                start_timer();
            }
        }
    `;
    const findings = find_out_of_scope_calls(sample);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, "start_timer");
});

test("scope lint ignores strings, comments and same-block usage", () => {
    const sample = `
        function handler(){
            const run_task = () => {};
            run_task();
            //run_task();
            const label = "run_task";
            const html = \`<span>run_task</span>\`;
            return label + html;
        }
    `;
    assert.deepEqual(find_out_of_scope_calls(sample), []);
});

test("project scripts do not call block-scoped functions from outside their block", () => {
    const files = walk(root).filter((path) => path.endsWith(".js") || path.endsWith(".mjs"));
    const failures = [];
    for (const file of files) {
        for (const finding of find_out_of_scope_calls(readFileSync(file, "utf8"))) {
            failures.push(`${relative(root, file)}: ${finding.name} (宣言 ${finding.declared_line}行 / 使用 ${finding.used_line}行)`);
        }
    }
    assert.deepEqual(failures, []);
});
