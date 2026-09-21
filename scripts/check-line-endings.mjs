#!/usr/bin/env node
// 行末形式(LF/CRLF)と末尾改行を、バイト単位で正本ポリシーと照合する。
//
// 本家は改行コードがファイルごとに異なるため、リポジトリ全体を一律変換できない。
// 一方でエディタやパッチ適用ツールは書き戻し時に行末を変換してしまう。
// そこで「どのファイルがどの形式か」を eol-policy.json に正本として持ち、
// pre-commit と CI の両方から同じ検査を呼ぶ。
//
// 使い方:
//   node scripts/check-line-endings.mjs --staged              コミット予定の内容を検査 (pre-commit)
//   node scripts/check-line-endings.mjs --all                 追跡中の全ファイルを検査
//   node scripts/check-line-endings.mjs --all --fix           期待値へ書き戻す
//   node scripts/check-line-endings.mjs --adopt [path...]     実測値を正本として登録する
//   node scripts/check-line-endings.mjs --sync-editorconfig   .editorconfig を再生成する

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = join(repoRoot, "eol-policy.json");
const editorConfigPath = join(repoRoot, ".editorconfig");

function git(args) {
    return execFileSync("git", args, { cwd: repoRoot, maxBuffer: 1 << 28 });
}

function gitText(args) {
    return git(args).toString("utf8");
}

function readRepoFile(path) {
    try {
        return readFileSync(join(repoRoot, path));
    } catch {
        return null;
    }
}

// 作業ツリーではなく「これからコミットされる内容」を検査する。
function readIndex(path) {
    try {
        return git(["show", `:${path}`]);
    } catch {
        return null;
    }
}

// --- 正本ポリシー --------------------------------------------------------

function loadPolicy() {
    const raw = JSON.parse(readFileSync(policyPath, "utf8"));
    return {
        default: raw.default,
        conventions: raw.conventions ?? [],
        files: raw.files ?? {}
    };
}

function globToRegExp(pattern) {
    let source = "^";
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === "*") {
            if (pattern[i + 1] === "*") {
                source += ".*";
                i++;
                if (pattern[i + 1] === "/") i++;
            } else {
                source += "[^/]*";
            }
        } else if (char === "?") {
            source += "[^/]";
        } else {
            source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`${source}$`);
}

// 期待値は 正本テーブル > 規約glob > 既定 の順で決まる。
//
// 「変更前のバイトを期待値にする」ことはしない。それをすると、既にコミット
// されている形式が常に正しいことになり、意図した正規化を検査が永久に拒む。
// 本家取り込みで増えた未登録ファイルは既定と違えば報告されるが、それは
// npm run eol:adopt で正本へ登録すべきものなので、黙って通すより望ましい。
function expectedFor(path, policy) {
    const exact = policy.files[path];
    if (exact) return { ...exact, source: "eol-policy.json (files)" };

    let matched = null;
    for (const convention of policy.conventions) {
        if (globToRegExp(convention.pattern).test(path)) matched = convention;
    }
    if (matched) return { ...matched, source: `eol-policy.json (conventions: ${matched.pattern})` };

    return { ...policy.default, source: "eol-policy.json (default)" };
}

// --- バイト検査 ----------------------------------------------------------

export function analyze(buffer) {
    if (buffer.length === 0) return { empty: true };
    if (buffer.includes(0)) return { binary: true };

    let crlf = 0;
    let lf = 0;
    let cr = 0;
    for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === 0x0d) {
            if (buffer[i + 1] === 0x0a) {
                crlf++;
                i++;
            } else {
                cr++;
            }
        } else if (buffer[i] === 0x0a) {
            lf++;
        }
    }

    let eol = "none";
    if (crlf > 0 && lf > 0) eol = "mixed";
    else if (crlf > 0) eol = "crlf";
    else if (lf > 0) eol = "lf";

    const lastByte = buffer[buffer.length - 1];
    return { crlf, lf, cr, eol, finalNewline: lastByte === 0x0a || lastByte === 0x0d };
}

export function normalize(buffer, expected) {
    const text = buffer.toString("utf8").replace(/\r\n|\r|\n/g, "\n");
    const newline = expected.eol === "crlf" ? "\r\n" : "\n";
    let body = expected.eol === "crlf" ? text.replace(/\n/g, "\r\n") : text;
    if (expected.finalNewline) {
        if (!body.endsWith(newline)) body += newline;
    } else {
        while (body.endsWith(newline)) body = body.slice(0, -newline.length);
    }
    return Buffer.from(body, "utf8");
}

const LABEL = { crlf: "CRLF", lf: "LF", mixed: "CRLF と LF の混在", none: "改行なし" };

export function inspect(buffer, expected) {
    const actual = analyze(buffer);
    if (actual.empty || actual.binary) return [];

    const problems = [];
    if (actual.cr > 0) {
        problems.push(`CR 単独の改行が ${actual.cr} 箇所あります`);
    }
    if (actual.eol !== "none" && actual.eol !== expected.eol) {
        problems.push(`行末が ${LABEL[actual.eol]} です (正本は ${LABEL[expected.eol]})`);
    }
    if (actual.finalNewline !== expected.finalNewline) {
        problems.push(
            expected.finalNewline
                ? "末尾に改行がありません (正本: あり)"
                : "末尾に余分な改行があります (正本: なし)"
        );
    }
    return problems;
}

// --- 対象ファイルの収集 --------------------------------------------------

function trackedFiles() {
    return gitText(["ls-files", "-z"]).split("\0").filter(Boolean);
}

// A(追加) / M(変更) / R(改名) を対象にする。D(削除) は検査できない。
function stagedFiles() {
    const args = ["diff", "--name-status", "-z", "--diff-filter=AMR", "--find-renames", "--cached", "HEAD"];

    const fields = gitText(args).split("\0").filter(Boolean);
    const targets = [];
    for (let i = 0; i < fields.length; i++) {
        const status = fields[i];
        // 改名は「改名前・改名後」の2欄を持つ。検査対象は改名後の内容。
        if (status.startsWith("R")) i++;
        targets.push(fields[++i]);
    }
    return targets;
}

// --- 検査 ----------------------------------------------------------------

function runCheck({ mode, fix }) {
    const policy = loadPolicy();
    const targets = mode === "all" ? trackedFiles() : stagedFiles();

    const failures = [];

    for (const path of targets) {
        // --fix は作業ツリーを直すので、読む対象も作業ツリーに合わせる。
        const buffer = mode === "staged" && !fix ? readIndex(path) : readRepoFile(path);
        if (!buffer) continue;

        const expected = expectedFor(path, policy);
        const problems = inspect(buffer, expected);
        if (problems.length === 0) continue;

        if (fix) {
            writeFileSync(join(repoRoot, path), normalize(buffer, expected));
            const tail = expected.finalNewline ? "あり" : "なし";
            console.log(`修正しました: ${path} -> ${LABEL[expected.eol]} / 末尾改行 ${tail}`);
            continue;
        }
        failures.push({ path, problems, expected });
    }

    if (failures.length === 0) {
        if (!fix) console.log(`行末検査: 問題なし (${targets.length} ファイル)`);
        return 0;
    }

    console.error("行末形式が正本と一致しません。");
    console.error("");
    for (const { path, problems, expected } of failures) {
        console.error(`  ${path}`);
        for (const problem of problems) console.error(`    - ${problem}`);
        const tail = expected.finalNewline ? "あり" : "なし";
        console.error(`    正本: ${LABEL[expected.eol]} / 末尾改行 ${tail} (${expected.source})`);
    }
    console.error("");
    console.error("このままでは本家との差分が全面化し、更新の取り込みで衝突します。");
    console.error("");
    console.error("修正方法:");
    console.error("  npm run eol:fix                     正本の形式へ書き戻す (作業ツリー)");
    console.error("  npm run eol:adopt -- <path>         本家由来で実測値が正しい場合に正本へ登録する");
    console.error("  正本: eol-policy.json / 方針: docs/dev/line-ending-policy.md");
    return 1;
}

// --- 正本への登録 --------------------------------------------------------

function runAdopt(paths) {
    const policy = loadPolicy();
    const targets = paths.length > 0 ? paths : trackedFiles();
    let changed = 0;

    for (const path of targets) {
        const buffer = readRepoFile(path);
        if (!buffer) continue;

        const actual = analyze(buffer);
        if (actual.empty || actual.binary || actual.eol === "none") continue;
        if (actual.cr > 0) {
            console.error(`CR 単独の改行があるため登録しません: ${path}`);
            continue;
        }
        if (actual.eol === "mixed") {
            console.error(`行末が混在しているため登録しません: ${path}`);
            continue;
        }

        const observed = { eol: actual.eol, finalNewline: actual.finalNewline };
        const withoutExact = { ...policy, files: { ...policy.files } };
        delete withoutExact.files[path];
        const fallback = expectedFor(path, withoutExact);
        const current = policy.files[path];

        if (fallback.eol === observed.eol && fallback.finalNewline === observed.finalNewline) {
            // 規約や既定で説明できるものは、テーブルを太らせない。
            if (current) {
                delete policy.files[path];
                changed++;
            }
        } else if (!current || current.eol !== observed.eol || current.finalNewline !== observed.finalNewline) {
            policy.files[path] = { ...observed, note: current?.note ?? "実測値を登録" };
            changed++;
        }
    }

    if (changed > 0) writePolicy(policy);
    console.log(`正本テーブルの更新: ${changed} 件`);
    return 0;
}

function writePolicy(policy) {
    const sorted = {};
    for (const key of Object.keys(policy.files).sort()) sorted[key] = policy.files[key];

    const raw = JSON.parse(readFileSync(policyPath, "utf8"));
    raw.files = sorted;
    writeFileSync(policyPath, `${JSON.stringify(raw, null, 2)}\n`);
}

// --- .editorconfig の生成 ------------------------------------------------

// 正本を二重管理するとずれるため、.editorconfig は eol-policy.json から生成する。
export function renderEditorConfig(policy) {
    const lines = [
        "# エディタによる行末変換を防ぐ。",
        "# このファイルは eol-policy.json から生成される。手で編集せず npm run eol:sync を使う。",
        "# .editorconfig はパッチ適用ツールや任意のスクリプトを制御しないため、",
        "# 実際の担保は scripts/check-line-endings.mjs の検査で行う。",
        "root = true",
        "",
        "[*]",
        "charset = utf-8",
        `end_of_line = ${policy.default.eol}`,
        `insert_final_newline = ${policy.default.finalNewline}`,
        ""
    ];

    const emit = (glob, rule) => {
        if (rule.note) lines.push(`# ${rule.note}`);
        lines.push(`[${glob}]`);
        lines.push(`end_of_line = ${rule.eol}`);
        lines.push(`insert_final_newline = ${rule.finalNewline}`);
        lines.push("");
    };

    for (const convention of policy.conventions) emit(`/${convention.pattern}`, convention);
    for (const path of Object.keys(policy.files).sort()) emit(`/${path}`, policy.files[path]);

    return lines.join("\n");
}

function runSyncEditorConfig({ check }) {
    const expected = renderEditorConfig(loadPolicy());
    let current = null;
    try {
        current = readFileSync(editorConfigPath, "utf8");
    } catch {
        current = null;
    }

    if (current === expected) {
        console.log(".editorconfig: 正本と一致しています");
        return 0;
    }
    if (check) {
        console.error(".editorconfig が eol-policy.json と一致しません。npm run eol:sync を実行してください。");
        return 1;
    }
    writeFileSync(editorConfigPath, expected);
    console.log(".editorconfig を再生成しました");
    return 0;
}

// --- 引数 ----------------------------------------------------------------

export function main(argv) {
    const positional = [];
    let mode = null;
    let fix = false;
    let adopt = false;
    let sync = false;
    let syncCheck = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--staged") mode = "staged";
        else if (arg === "--all") mode = "all";
        else if (arg === "--fix") fix = true;
        else if (arg === "--adopt") adopt = true;
        else if (arg === "--sync-editorconfig") sync = true;
        else if (arg === "--check-editorconfig") {
            sync = true;
            syncCheck = true;
        } else if (arg.startsWith("--")) {
            console.error(`不明なオプション: ${arg}`);
            return 2;
        } else positional.push(arg);
    }

    if (adopt) return runAdopt(positional);
    if (sync) return runSyncEditorConfig({ check: syncCheck });
    if (!mode) {
        console.error("モードを指定してください: --staged / --all / --adopt / --sync-editorconfig");
        return 2;
    }
    return runCheck({ mode, fix });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    process.exit(main(process.argv.slice(2)));
}
