// review-kit(node_modules)を使う側の契約。エンジン自体のテストは review-kit リポジトリにある。
// ここでは Open-Deck 固有の設定・レンズ・自動修正方針と、台帳・生成物が現行エンジンと整合していることを確かめる。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BIN = "node_modules/review-kit/bin/review-kit.mjs";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function reviewKit(args) {
  return execFileAsync(process.execPath, [BIN, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

test("review config は既存の BL 台帳の契約を保つ", async () => {
  const config = await readJson("review.config.json");
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.vocabulary.findingIdPrefix, "BL");
  assert.equal(config.paths.findings, "docs/backlog/findings.jsonl");
  assert.equal(config.paths.report, "docs/backlog/report.md");
  assert.equal(config.skills.scriptPrefix, "backlog");
  assert.deepEqual(config.defaults, { category: "architecture", verificationRequired: "code" });
  assert.deepEqual(config.verification, ["npm run test:unit", "npm run backlog:validate -- --report"]);
});

test("レンズは移植時に合意した最小構成を持つ", async () => {
  const lenses = (await readFile("review/lenses.jsonl", "utf8")).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  for (const check of ["docs-links", "hardcoded-path", "evidence-stale"]) assert.ok(lenses.some((lens) => lens.check === check), check);
  for (const id of ["LENS-test-quality", "LENS-docs-drift", "LENS-extension-contract"]) assert.ok(lenses.some((lens) => lens.id === id), id);
});

test("自動修正は custom 基点の docs-link だけで、方針・エンジン・生成スキルに触れない", async () => {
  const policy = await readJson("review/autofix-policy.json");
  assert.equal(policy.baseBranch, "custom");
  assert.deepEqual(Object.keys(policy.classes), ["docs-link"]);
  for (const pattern of ["manifest.json", ".github/**", "node_modules/**", "package-lock.json", "review/**", ".claude/skills/backlog/**", ".agents/skills/review-*/**", "docs/dev/automated-review-cycle-runbook.md"]) {
    assert.ok(policy.forbiddenPaths.includes(pattern), pattern);
  }
});

test("台帳と report.md が現行エンジンで整合している", async () => {
  const { stdout } = await reviewKit(["backlog", "validate", "--report"]);
  assert.match(stdout, /validated \d+ finding\(s\) and report/);
});

test("生成スキルが雛形・設定とずれていない", async () => {
  const { stdout } = await reviewKit(["skills", "check"]);
  assert.match(stdout, /up to date/);
});
