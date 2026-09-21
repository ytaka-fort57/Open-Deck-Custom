import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyze, inspect, normalize, main } from "../scripts/check-line-endings.mjs";

const CRLF = { eol: "crlf", finalNewline: true };
const LF = { eol: "lf", finalNewline: true };

test("analyze は CRLF と LF と単独CR をバイトで数え分ける", () => {
    assert.deepEqual(analyze(Buffer.from("a\r\nb\r\n")), {
        crlf: 2,
        lf: 0,
        cr: 0,
        eol: "crlf",
        finalNewline: true
    });
    assert.deepEqual(analyze(Buffer.from("a\nb")), {
        crlf: 0,
        lf: 1,
        cr: 0,
        eol: "lf",
        finalNewline: false
    });
    assert.equal(analyze(Buffer.from("a\r\nb\nc")).eol, "mixed");
    assert.equal(analyze(Buffer.from("a\rb")).cr, 1);
});

test("analyze は空ファイルとバイナリを検査対象から外す", () => {
    assert.deepEqual(analyze(Buffer.alloc(0)), { empty: true });
    assert.deepEqual(analyze(Buffer.from([0x50, 0x00, 0x4e])), { binary: true });
});

test("inspect は行末・末尾改行・単独CR の不一致を報告する", () => {
    assert.deepEqual(inspect(Buffer.from("a\r\n"), CRLF), []);
    assert.equal(inspect(Buffer.from("a\n"), CRLF).length, 1);
    assert.equal(inspect(Buffer.from("a\r\nb"), CRLF).length, 1, "末尾改行なし");
    assert.equal(inspect(Buffer.from("a\r\nb\nc\r\n"), CRLF).length, 1, "混在");
    assert.equal(inspect(Buffer.from("a\rb\r\n"), CRLF).length, 1, "単独CR");
    assert.deepEqual(inspect(Buffer.from("a\n"), { eol: "lf", finalNewline: false }), [
        "末尾に余分な改行があります (正本: なし)"
    ]);
});

test("inspect は改行を含まないファイルの行末形式を問わない", () => {
    assert.deepEqual(inspect(Buffer.from("a"), { eol: "crlf", finalNewline: false }), []);
});

test("normalize は期待値どおりのバイト列を作る", () => {
    assert.equal(normalize(Buffer.from("a\nb\n"), CRLF).toString(), "a\r\nb\r\n");
    assert.equal(normalize(Buffer.from("a\r\nb\r\n"), LF).toString(), "a\nb\n");
    assert.equal(normalize(Buffer.from("a\rb"), LF).toString(), "a\nb\n", "単独CRも畳む");
    assert.equal(
        normalize(Buffer.from("a\r\n\r\n"), { eol: "crlf", finalNewline: false }).toString(),
        "a"
    );
});

test("追跡中の全ファイルが eol-policy.json の正本と一致する", () => {
    assert.equal(main(["--all"]), 0);
});

test(".editorconfig は eol-policy.json から生成された内容と一致する", () => {
    assert.equal(main(["--check-editorconfig"]), 0);
});

test("正本は本家由来ファイルの形式を混同していない", () => {
    const policy = JSON.parse(readFileSync(new URL("../eol-policy.json", import.meta.url), "utf8"));
    assert.equal(policy.files["manifest.json"].eol, "crlf");
    assert.equal(policy.files["manifest.json"].finalNewline, false);
    assert.equal(policy.files["manifest_firefox.json"].eol, "lf");
    assert.equal(policy.files["manifest_firefox.json"].finalNewline, false);
    assert.equal(policy.files["content.js"].eol, "crlf");
    assert.equal(policy.default.eol, "lf");
});
