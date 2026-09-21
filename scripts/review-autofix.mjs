// 自動修正ゲート（設計 §2.8）。
// 設計: docs/dev/automated-review-cycle-design-2026-09-16.md
// 手順: docs/dev/automated-review-cycle-runbook.md の「自動修正」
//
// 1 回 = 1 発見事項 = 1 ブランチ = 1 PR。流れは candidates → start → （修正してコミット）→ gate → PR → finish。
// 「直してよいか」は review/autofix-policy.json と発見事項の `autofix:<class>` タグだけで決まり、
// 修正する側（エージェント）には判断させない。ゲートは CI でも同じものを回すので、手元で飛ばしても PR で止まる。
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { matchesAny, REPO_ROOT } from "./review-lenses.mjs";
import { createFsContext, getCheck } from "./review-checks.mjs";
import { isSuppressed, main as backlogMain, validateRecords } from "./backlog.mjs";
import { configuredBookkeepingPaths, IMMUTABLE_EXCLUDE, REVIEW_CONFIG, REVIEW_PATHS } from "./review-config.mjs";

const execFileAsync = promisify(execFile);

export const POLICY_FILE = REVIEW_PATHS.autofixPolicy;
const FIXES_FILE = REVIEW_PATHS.fixes;
const FINDINGS_FILE = REVIEW_PATHS.findings;

export const AUTOFIX_TAG_PREFIX = "autofix:";
// 自動修正が止まった項目に付ける。付いている限り候補に戻らない（人が --untag で外す）。
export const BLOCKED_TAG = "autofix-blocked";
export const FIX_OUTCOMES = ["running", "gate-passed", "gate-failed", "pr-opened", "merged", "verified", "closed", "blocked", "abandoned"];
// これ以上ゲートを記録しない・開いているブランチに数えない結果。merged は squash マージでブランチが --no-merged に残る場合に備える。
const CLOSED_OUTCOMES = ["blocked", "abandoned", "closed", "merged", "verified"];

function fail(message) {
  throw new Error(message);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- policy */

export function validatePolicy(policy, config = REVIEW_CONFIG) {
  if (!policy || typeof policy !== "object") fail("autofix policy must be an object");
  for (const field of ["baseBranch", "branchPrefix"]) {
    if (typeof policy[field] !== "string" || !policy[field]) fail(`policy.${field} must be a non-empty string`);
  }
  if (!Number.isInteger(policy.maxOpenBranches) || policy.maxOpenBranches < 1) fail("policy.maxOpenBranches must be a positive integer");
  for (const field of ["maxChangedFiles", "maxChangedLines"]) {
    if (!Number.isInteger(policy.limits?.[field]) || policy.limits[field] < 1) fail(`policy.limits.${field} must be a positive integer`);
  }
  for (const field of ["maxChangedFiles", "maxChangedLines"]) {
    if (!Number.isInteger(policy.bookkeepingLimits?.[field]) || policy.bookkeepingLimits[field] < 1) {
      fail(`policy.bookkeepingLimits.${field} must be a positive integer`);
    }
  }
  for (const field of ["forbiddenPaths", "excludeCategories"]) {
    if (!Array.isArray(policy[field])) fail(`policy.${field} must be an array`);
  }
  const classes = Object.entries(policy.classes ?? {});
  if (!classes.length) fail("policy.classes must not be empty");
  for (const [id, entry] of classes) {
    if (!/^[a-z0-9-]+$/.test(id)) fail(`policy.classes.${id} has an invalid id`);
    if (!Array.isArray(entry.scope) || !entry.scope.length) fail(`policy.classes.${id}.scope must not be empty`);
    if (entry.check !== undefined) getCheck(entry.check);
    if (typeof entry.requireTestChange !== "boolean") fail(`policy.classes.${id}.requireTestChange must be a boolean`);
  }
  return {
    ...policy,
    verify: [...config.verification],
    bookkeepingPaths: configuredBookkeepingPaths(config),
    forbiddenPaths: [...new Set([...policy.forbiddenPaths, ...IMMUTABLE_EXCLUDE, config.paths.autofixPolicy])]
  };
}

export async function readPolicy(file = POLICY_FILE) {
  return validatePolicy(JSON.parse(await fs.readFile(file, "utf8")));
}

/* ----------------------------------------------------------- eligibility */

export function autofixClassesOf(record) {
  return (record.tags ?? []).filter((tag) => tag.startsWith(AUTOFIX_TAG_PREFIX)).map((tag) => tag.slice(AUTOFIX_TAG_PREFIX.length));
}

export function branchNameFor(record, fixClass, policy) {
  return `${policy.branchPrefix}${record.id.toLowerCase()}-${fixClass}`;
}

// ブランチ名から発見事項と区分を戻す。CI はレジャーを持たないので、ここだけを手掛かりにする。
export function parseBranchName(branch, policy, findingIdPrefix = REVIEW_CONFIG.vocabulary.findingIdPrefix) {
  if (!branch?.startsWith(policy.branchPrefix)) return null;
  const prefix = findingIdPrefix.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = branch.slice(policy.branchPrefix.length).match(new RegExp(`^(${prefix}-\\d+)-([a-z0-9-]+)$`));
  if (!match) return null;
  return { findingId: match[1].toUpperCase(), fixClass: match[2] };
}

export function assessEligibility(record, policy, { on = today(), existingBranches = [] } = {}) {
  const reasons = [];
  const classes = autofixClassesOf(record);
  const fixClass = classes.length === 1 ? classes[0] : null;
  if (!classes.length) reasons.push("autofix:<class> タグがない（人が付けるまで対象外）");
  if (classes.length > 1) reasons.push(`autofix タグが複数ある: ${classes.join(", ")}`);
  const classPolicy = fixClass ? policy.classes[fixClass] : null;
  if (fixClass && !classPolicy) reasons.push(`未知の区分: ${fixClass}`);
  if ((record.tags ?? []).includes(BLOCKED_TAG)) reasons.push(`${BLOCKED_TAG} が付いている（前回の自動修正が止まった）`);
  if (record.status !== "triaged") reasons.push(`status が triaged ではない: ${record.status}`);
  if (record.status === "triaged" && isSuppressed(record, on)) reasons.push("抑止中");
  if (policy.excludeCategories.includes(record.category)) reasons.push(`category ${record.category} は自動修正しない`);
  if (record.verificationRequired !== "code") reasons.push(`verificationRequired が code ではない: ${record.verificationRequired}（実画面確認が要る）`);
  if (!record.acceptanceCriteria?.length) reasons.push("acceptanceCriteria がない（ゲートで何を満たせば良いか決まらない）");
  for (const entry of record.evidence ?? []) {
    if (entry.type !== "code") continue;
    if (matchesAny(entry.file, policy.forbiddenPaths)) reasons.push(`根拠が触らせないパスにある: ${entry.file}`);
    else if (classPolicy && !matchesAny(entry.file, classPolicy.scope)) reasons.push(`根拠が区分 ${fixClass} の範囲外: ${entry.file}`);
  }
  const branchPrefix = `${policy.branchPrefix}${record.id.toLowerCase()}-`;
  const existing = existingBranches.find((branch) => branch.startsWith(branchPrefix));
  if (existing) reasons.push(`既にブランチがある: ${existing}`);
  return { id: record.id, eligible: reasons.length === 0, fixClass, reasons };
}

/* ------------------------------------------------------------------ diff */

// `git diff --numstat --no-renames` の出力。バイナリは `-\t-\tfile`。
export function parseNumstat(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const [added, deleted, ...rest] = line.split("\t");
    const binary = added === "-" || deleted === "-";
    return { file: rest.join("\t").replaceAll("\\", "/"), added: binary ? 0 : Number(added), deleted: binary ? 0 : Number(deleted), binary };
  });
}

export function assessDiff(changes, { fixClass, policy }) {
  const violations = [];
  const classPolicy = policy.classes[fixClass];
  if (!classPolicy) return { ok: false, violations: [`未知の区分: ${fixClass}`], files: 0, lines: 0, bookkeepingFiles: 0, bookkeepingLines: 0, changed: [] };
  const counted = [];
  const bookkeeping = [];
  for (const change of changes) {
    if (matchesAny(change.file, policy.forbiddenPaths)) {
      violations.push(`触らせないパスを変更している: ${change.file}`);
      continue;
    }
    if (matchesAny(change.file, policy.bookkeepingPaths)) {
      bookkeeping.push(change);
      continue;
    }
    if (change.binary) violations.push(`バイナリを変更している: ${change.file}`);
    if (!matchesAny(change.file, classPolicy.scope)) violations.push(`区分 ${fixClass} の範囲外を変更している: ${change.file}`);
    counted.push(change);
  }
  const lines = counted.reduce((sum, change) => sum + change.added + change.deleted, 0);
  if (!counted.length) violations.push("修正差分がない（台帳・バックログ以外の変更が 0 件）");
  if (counted.length > policy.limits.maxChangedFiles) violations.push(`変更ファイル数 ${counted.length} が上限 ${policy.limits.maxChangedFiles} を超える`);
  if (lines > policy.limits.maxChangedLines) violations.push(`変更行数 ${lines} が上限 ${policy.limits.maxChangedLines} を超える`);
  if (classPolicy.requireTestChange && !counted.some((change) => change.file.startsWith("tests/"))) {
    violations.push(`区分 ${fixClass} は tests/ の変更（回帰テスト）を必須にしている`);
  }
  const bookkeepingLines = bookkeeping.reduce((sum, change) => sum + change.added + change.deleted, 0);
  if (bookkeeping.some((change) => change.binary)) violations.push("台帳・バックログにバイナリ変更がある");
  if (bookkeeping.length > policy.bookkeepingLimits.maxChangedFiles) {
    violations.push(`台帳・バックログの変更ファイル数 ${bookkeeping.length} が上限 ${policy.bookkeepingLimits.maxChangedFiles} を超える`);
  }
  if (bookkeepingLines > policy.bookkeepingLimits.maxChangedLines) {
    violations.push(`台帳・バックログの変更行数 ${bookkeepingLines} が上限 ${policy.bookkeepingLimits.maxChangedLines} を超える`);
  }
  return {
    ok: violations.length === 0,
    violations,
    files: counted.length,
    lines,
    bookkeepingFiles: bookkeeping.length,
    bookkeepingLines,
    changed: counted.map((change) => change.file)
  };
}

/* ---------------------------------------------------------------- ledger */

export function parseFixes(content) {
  return content.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      return fail(`invalid JSONL at ${REVIEW_CONFIG.paths.fixes} line ${index + 1}: ${error.message}`);
    }
  });
}

export function serializeFixes(fixes) {
  return fixes.map((fix) => JSON.stringify(fix)).join("\n") + (fixes.length ? "\n" : "");
}

async function readFixes(file = FIXES_FILE) {
  try {
    return parseFixes(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeFixes(fixes) {
  await fs.mkdir(path.dirname(FIXES_FILE), { recursive: true });
  const temporary = `${FIXES_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, serializeFixes(fixes), "utf8");
    await fs.rename(temporary, FIXES_FILE);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export function nextFixId(fixes, date = today()) {
  const prefix = `FIX-${date}-`;
  const used = fixes.filter((fix) => fix.fixId?.startsWith(prefix)).length;
  return `${prefix}${String(used + 1).padStart(2, "0")}`;
}

// 止めた（blocked / abandoned）ブランチは開いている数に数えない。人が片付けるまで残すため。
export function countOpenBranches(branches, fixes) {
  const closed = new Set(fixes.filter((fix) => CLOSED_OUTCOMES.includes(fix.outcome)).map((fix) => fix.branch));
  return branches.filter((branch) => !closed.has(branch));
}

async function readFindings(file = FINDINGS_FILE) {
  const content = await fs.readFile(file, "utf8");
  return validateRecords(content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)));
}

/* ------------------------------------------------------------------- git */

async function git(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync("git", ["-c", `safe.directory=${REPO_ROOT.replaceAll("\\", "/")}`, ...args], { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(" ")} failed: ${error.stderr?.trim() || error.message}`, { cause: error });
  }
}

async function currentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

async function autofixBranches(policy) {
  const local = await git(["branch", "--list", `${policy.branchPrefix}*`, "--no-merged", policy.baseBranch, "--format=%(refname:short)"], { allowFailure: true });
  const remote = await git(["ls-remote", "--heads", "origin", `${policy.branchPrefix}*`], { allowFailure: true });
  const names = (local ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of (remote ?? "").split("\n")) {
    const ref = line.split(/\s+/)[1] ?? "";
    if (ref.startsWith("refs/heads/")) names.push(ref.slice("refs/heads/".length));
  }
  return [...new Set(names)];
}

async function dirtyFiles() {
  const status = await git(["status", "--porcelain", "--untracked-files=all"]);
  return status.split("\n").filter(Boolean).map((line) => line.slice(3).trim().replace(/^"|"$/g, "").replaceAll("\\", "/"));
}

export function defaultWorktreePath(repoRoot, branch) {
  const repo = path.basename(repoRoot).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const leaf = branch.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return path.join(path.dirname(repoRoot), ".autofix-worktrees", repo, leaf);
}

export async function acquireFindingLock(lockDirectory, metadata = {}) {
  await fs.mkdir(path.dirname(lockDirectory), { recursive: true });
  try {
    await fs.mkdir(lockDirectory);
  } catch (error) {
    if (error.code === "EEXIST") fail(`同じfindingの自動修正開始が進行中: ${lockDirectory}`);
    throw error;
  }
  try {
    await fs.writeFile(path.join(lockDirectory, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ...metadata }, null, 2)}\n`, "utf8");
  } catch (error) {
    await fs.rm(lockDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await fs.rm(lockDirectory, { recursive: true, force: true });
  };
}

async function startLockPath() {
  return path.join(await gitCommonDirectory(), "review-autofix-locks", "start.lock");
}

async function gitCommonDirectory() {
  return path.resolve(REPO_ROOT, await git(["rev-parse", "--git-common-dir"]));
}

async function recoveryDirectory() {
  return path.join(await gitCommonDirectory(), "review-autofix-recovery");
}

async function writeRecoveryRecord(entry, workNote) {
  const directory = await recoveryDirectory();
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${entry.fixId}.json`);
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ entry, workNote }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readRecoveryRecords() {
  const directory = await recoveryDirectory();
  const names = await fs.readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const rows = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const file = path.join(directory, name);
    rows.push({ file, ...JSON.parse(await fs.readFile(file, "utf8")) });
  }
  return rows;
}

async function allocatedFixes(mainFixes) {
  const byId = new Map(mainFixes.map((entry) => [entry.fixId, entry]));
  const listed = await git(["worktree", "list", "--porcelain"], { allowFailure: true });
  for (const line of (listed ?? "").split(/\r?\n/).filter((entry) => entry.startsWith("worktree "))) {
    const worktree = line.slice("worktree ".length);
    if (path.resolve(worktree) === path.resolve(REPO_ROOT)) continue;
    const ledger = path.join(worktree, ...REVIEW_CONFIG.paths.fixes.split("/"));
    try {
      for (const entry of parseFixes(await fs.readFile(ledger, "utf8"))) byId.set(entry.fixId, entry);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const row of await readRecoveryRecords()) byId.set(row.entry.fixId, row.entry);
  return [...byId.values()];
}

async function activateWorktree(worktree, id, { fixId, baseCommit }) {
  const script = path.join(worktree, "scripts", "review-autofix.mjs");
  try {
    await execFileAsync(process.execPath, [script, "_activate", id, "--fix-id", fixId, "--base-commit", baseCommit, "--worktree", worktree], {
      cwd: worktree,
      env: { ...process.env, REVIEW_REPO_ROOT: worktree, REVIEW_CONFIG_FILE: path.join(worktree, "review.config.json") },
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    throw new Error(`隔離worktreeの開始記録に失敗した。worktreeとbranchは調査用に残す: ${worktree}: ${error.stderr?.trim() || error.message}`, { cause: error });
  }
}

function runShell(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: REPO_ROOT, shell: true, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export function gateAuthorization(record, fixClass, policy) {
  const violations = [];
  if (!record) return ["基点ブランチ側に対応する発見事項がない"];
  const classes = autofixClassesOf(record);
  if (classes.length !== 1 || classes[0] !== fixClass) {
    violations.push(`発見事項の autofix タグがブランチ区分と一致しない: ${classes.join(", ") || "なし"}`);
  }
  if (!["triaged", "in-progress"].includes(record.status)) violations.push(`発見事項の状態が自動修正の許可状態ではない: ${record.status}`);
  if ((record.tags ?? []).includes(BLOCKED_TAG)) violations.push(`${BLOCKED_TAG} が付いている`);
  if (policy.excludeCategories.includes(record.category)) violations.push(`category ${record.category} は自動修正しない`);
  if (record.verificationRequired !== "code") violations.push(`verificationRequired が code ではない: ${record.verificationRequired}`);
  if (!record.acceptanceCriteria?.length) violations.push("acceptanceCriteria がない");
  const classPolicy = policy.classes[fixClass];
  for (const entry of record.evidence ?? []) {
    if (entry.type !== "code") continue;
    if (matchesAny(entry.file, policy.forbiddenPaths)) violations.push(`根拠が触らせないパスにある: ${entry.file}`);
    else if (classPolicy && !matchesAny(entry.file, classPolicy.scope)) violations.push(`根拠が区分 ${fixClass} の範囲外: ${entry.file}`);
  }
  return violations;
}

export function validatePrOpenedArgs(prNumber, prUrl) {
  if (!prNumber || !/^\d+$/.test(String(prNumber)) || Number(prNumber) < 1) fail("pr-opened には実際のPR番号を --pr-number で渡す");
  if (!prUrl || !/^https?:\/\//.test(prUrl)) fail("pr-opened には実際のPR URLを --pr-url で渡す");
  return { number: Number(prNumber), url: prUrl };
}

/* ------------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) fail("usage: node scripts/review-autofix.mjs <candidates|start|gate|finish|pr-body|sync>");
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = rest[index + 1];
    options.set(name, next !== undefined && !next.startsWith("--") ? rest[++index] : true);
  }
  return { command, positionals, options };
}

const value = (options, name) => (typeof options.get(name) === "string" ? options.get(name) : undefined);

function renderBrief(record, fixClass, policy, branch) {
  const classPolicy = policy.classes[fixClass];
  return [
    `# ${record.id} — ${record.title}`,
    "",
    `- 区分: ${fixClass}（${classPolicy.title}）`,
    `- ブランチ: ${branch}`,
    `- 変更してよい範囲: ${classPolicy.scope.join(", ")}`,
    `- 上限: ${policy.limits.maxChangedFiles} ファイル / ${policy.limits.maxChangedLines} 行（台帳・バックログを除く）`,
    `- 回帰テスト: ${classPolicy.requireTestChange ? "tests/ の変更が必須" : "既存テストの通過で足りる"}${classPolicy.check ? ` + review-checks ${classPolicy.check} が変更ファイルで 0 件` : ""}`,
    `- 検証コマンド: ${policy.verify.join(" && ")}`,
    "",
    "## 発見事項",
    "",
    record.finding,
    "",
    "## 提案",
    "",
    Array.isArray(record.proposal) ? record.proposal.join("\n") : record.proposal,
    "",
    "## 受入条件",
    "",
    ...record.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "## 根拠",
    "",
    ...record.evidence.filter((entry) => entry.type === "code").map((entry) => `- ${entry.file}${entry.lines ? `:${entry.lines}` : ""}`),
    ""
  ].join("\n");
}

async function commandCandidates(options) {
  const policy = await readPolicy();
  const records = await readFindings();
  const existingBranches = await autofixBranches(policy);
  const tagged = records.filter((record) => autofixClassesOf(record).length || options.has("all"));
  const rows = sortAutofixCandidates(tagged
    .map((record) => ({ ...assessEligibility(record, policy, { existingBranches }), title: record.title, priority: record.priority })));
  if (options.has("json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(`autofix:<class> タグの付いた発見事項はない。npm run backlog:update -- ${REVIEW_CONFIG.vocabulary.findingIdPrefix}-0NN --tag autofix:<class> で人が指定する`);
    return;
  }
  for (const row of rows) {
    console.log(`${row.eligible ? "[OK]  " : "[SKIP]"} ${row.id} ${row.priority} ${row.fixClass ?? "—"} ${row.title}`);
    for (const reason of row.reasons) console.log(`        - ${reason}`);
  }
}

export function sortAutofixCandidates(rows) {
  const priorityOrder = new Map([["P1", 1], ["P2", 2], ["P3", 3]]);
  return [...rows].sort((left, right) => Number(right.eligible) - Number(left.eligible)
    || (priorityOrder.get(left.priority) ?? 99) - (priorityOrder.get(right.priority) ?? 99)
    || left.id.localeCompare(right.id));
}

async function commandStart(positionals, options) {
  const id = positionals[0];
  if (!id) fail(`usage: npm run review:autofix -- start ${REVIEW_CONFIG.vocabulary.findingIdPrefix}-0NN [--dry-run]`);
  const policy = await readPolicy();
  const records = await readFindings();
  const record = records.find((entry) => entry.id === id);
  if (!record) fail(`unknown finding: ${id}`);
  let branches = await autofixBranches(policy);
  let assessment = assessEligibility(record, policy, { existingBranches: branches });
  if (!assessment.eligible) fail(`${id} は自動修正の対象外:\n- ${assessment.reasons.join("\n- ")}`);
  const branch = branchNameFor(record, assessment.fixClass, policy);
  const brief = renderBrief(record, assessment.fixClass, policy, branch);
  if (options.has("dry-run")) {
    console.log(`（dry-run: ブランチ作成・台帳記録はしない）\n\n${brief}`);
    return;
  }
  const lockPath = await startLockPath();
  const release = await acquireFindingLock(lockPath, { finding: id, branch });
  try {
    const fixes = await readFixes();
    branches = await autofixBranches(policy);
    assessment = assessEligibility(record, policy, { existingBranches: branches });
    if (!assessment.eligible) fail(`${id} は自動修正の対象外:\n- ${assessment.reasons.join("\n- ")}`);
    const open = countOpenBranches(branches, fixes);
    if (open.length >= policy.maxOpenBranches) fail(`未マージの自動修正ブランチが上限 ${policy.maxOpenBranches} 本に達している: ${open.join(", ")}`);
    const baseCommit = await git(["rev-parse", `${policy.baseBranch}^{commit}`]);
    const fixId = nextFixId(await allocatedFixes(fixes));
    const worktree = path.resolve(value(options, "worktree") ?? defaultWorktreePath(REPO_ROOT, branch));
    await fs.mkdir(path.dirname(worktree), { recursive: true });
    await git(["worktree", "add", "-b", branch, worktree, baseCommit]);
    await activateWorktree(worktree, id, { fixId, baseCommit });
    console.log(`${fixId} started in isolated worktree\nworktree: ${worktree}\nbranch: ${branch}\nbase: ${baseCommit}\n\n${brief}`);
  } finally {
    await release();
  }
}

async function commandActivate(positionals, options) {
  const id = positionals[0];
  const fixId = value(options, "fix-id");
  const baseCommit = value(options, "base-commit");
  const worktree = value(options, "worktree");
  if (!id || !fixId || !baseCommit || !worktree) fail("_activate requires id, --fix-id, --base-commit, and --worktree");
  const policy = await readPolicy();
  const records = await readFindings();
  const record = records.find((entry) => entry.id === id);
  if (!record) fail(`unknown finding: ${id}`);
  const branch = await currentBranch();
  const parsed = parseBranchName(branch, policy);
  if (!parsed || parsed.findingId !== id) fail(`worktree branch does not match ${id}: ${branch}`);
  const violations = gateAuthorization(record, parsed.fixClass, policy);
  if (record.status !== "triaged") violations.push(`開始時のstatusがtriagedではない: ${record.status}`);
  if (violations.length) fail(`${id} の許可条件がworktree作成後に変わった:\n- ${violations.join("\n- ")}`);
  const fixes = await readFixes();
  const entry = {
    fixId,
    finding: id,
    fixClass: parsed.fixClass,
    branch,
    baseCommit,
    worktree: path.resolve(worktree),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    gate: null,
    outcome: "running",
    notes: []
  };
  await writeFixes([...fixes, entry]);
  try {
    await backlogMain(["update", id, "--status", "in-progress", "--work-note", `自動修正を隔離worktreeで開始（${fixId} / ${branch} / ${entry.worktree}）`]);
  } catch (error) {
    const latest = await readFixes();
    const recorded = [...latest].reverse().find((fix) => fix.fixId === fixId);
    if (recorded) Object.assign(recorded, { outcome: "blocked", finishedAt: new Date().toISOString(), notes: [...recorded.notes, `開始記録失敗: ${error.message}`] });
    await writeFixes(latest);
    throw error;
  }
}

async function commandGate(options) {
  // CI では PR 側の方針ファイルを信用しない（緩めた方針で自分を通せてしまう）。基点ブランチ側を --policy で渡す。
  const policy = await readPolicy(value(options, "policy") ? path.resolve(value(options, "policy")) : POLICY_FILE);
  const branch = value(options, "branch") ?? process.env.GITHUB_HEAD_REF ?? (await currentBranch());
  const parsed = parseBranchName(branch, policy);
  if (!parsed) fail(`自動修正ブランチではない: ${branch}（${policy.branchPrefix}${REVIEW_CONFIG.vocabulary.findingIdPrefix.toLowerCase()}-0nn-<class> の形式）`);
  const base = value(options, "base") ?? policy.baseBranch;
  const changes = parseNumstat(await git(["diff", "--numstat", "--no-renames", `${base}...HEAD`]));
  const result = assessDiff(changes, { fixClass: parsed.fixClass, policy });
  const findingsFile = value(options, "findings") ? path.resolve(value(options, "findings")) : FINDINGS_FILE;
  const fixesFile = value(options, "fixes") ? path.resolve(value(options, "fixes")) : FIXES_FILE;
  const records = await readFindings(findingsFile);
  const record = records.find((entry) => entry.id === parsed.findingId);
  const violations = [...gateAuthorization(record, parsed.fixClass, policy), ...result.violations];

  const fixes = await readFixes(fixesFile);
  const ledgerEntry = latestFixes(fixes).find((fix) => fix.branch === branch && fix.finding === parsed.findingId && fix.fixClass === parsed.fixClass);
  if (!ledgerEntry) violations.push("対応する自動修正台帳の記録がない（人の許可と開始記録を確認できない）");
  else if (!["running", "gate-passed", "gate-failed", "pr-opened"].includes(ledgerEntry.outcome)) violations.push(`自動修正台帳の状態がゲート対象外: ${ledgerEntry.outcome}`);

  const pending = (await dirtyFiles()).filter((file) => !matchesAny(file, policy.bookkeepingPaths));
  if (pending.length) violations.push(`未コミットの変更がある（ゲートはコミット済みの差分だけを見る）: ${pending.join(", ")}`);

  const classPolicy = policy.classes[parsed.fixClass];
  if (classPolicy?.check) {
    const check = getCheck(classPolicy.check);
    const targets = result.changed.filter((file) => matchesAny(file, check.scope));
    const issues = await check.run(createFsContext(REPO_ROOT, targets));
    for (const issue of issues) violations.push(`${check.id}: ${issue.file}${issue.line ? `:${issue.line}` : ""} — ${issue.message}`);
  }

  if (!violations.length && !options.has("skip-verify")) {
    for (const command of policy.verify) {
      console.log(`review-autofix: ${command}`);
      const code = await runShell(command);
      if (code !== 0) {
        violations.push(`検証コマンドが失敗した（exit ${code}）: ${command}`);
        break;
      }
    }
  }

  const gate = {
    at: new Date().toISOString(),
    base,
    ok: violations.length === 0,
    files: result.files,
    lines: result.lines,
    bookkeepingFiles: result.bookkeepingFiles,
    bookkeepingLines: result.bookkeepingLines,
    verified: !options.has("skip-verify") && violations.length === 0,
    violations
  };
  if (!options.has("no-record")) {
    const fixes = await readFixes();
    const entry = [...fixes].reverse().find((fix) => fix.branch === branch);
    if (entry && !CLOSED_OUTCOMES.includes(entry.outcome)) {
      entry.gate = gate;
      if (entry.outcome !== "pr-opened") entry.outcome = gate.ok ? "gate-passed" : "gate-failed";
      await writeFixes(fixes);
    }
  }
  if (options.has("json")) {
    console.log(JSON.stringify({ branch, ...parsed, ...gate }, null, 2));
  } else {
    console.log(`${gate.ok ? "[PASS]" : "[FAIL]"} ${branch} — ${result.files} ファイル / ${result.lines} 行`);
    for (const violation of violations) console.log(`  - ${violation}`);
  }
  if (!gate.ok) process.exitCode = 1;
}

async function commandFinish(positionals, options) {
  const policy = await readPolicy();
  const outcome = value(options, "outcome");
  if (!["pr-opened", "blocked", "abandoned"].includes(outcome)) fail("--outcome は pr-opened | blocked | abandoned");
  const branch = await currentBranch();
  if (!parseBranchName(branch, policy)) fail(`自動修正ブランチ上で実行する（現在: ${branch}）`);
  const fixes = await readFixes();
  const entry = [...fixes].reverse().find((fix) => fix.branch === branch && (!positionals[0] || fix.fixId === positionals[0]));
  if (!entry) fail(`台帳に ${branch} の記録がない`);
  const note = value(options, "note");

  if (outcome === "pr-opened") {
    if (!entry.gate?.ok || !entry.gate.verified) fail("検証付きでゲートを通過していない。npm run review:autofix -- gate を先に通す");
    const { number: prNumber, url: prUrl } = validatePrOpenedArgs(value(options, "pr-number"), value(options, "pr-url"));
    entry.outcome = outcome;
    entry.finishedAt = new Date().toISOString();
    entry.pr = prNumber;
    entry.prUrl = prUrl;
    if (note) entry.notes.push(note);
    await writeFixes(fixes);
    console.log(`${entry.fixId} pr-opened（PR #${entry.pr}）。台帳の変更をコミットして push する`);
    return;
  }

  // 止める場合は基点ブランチへ戻して記録する。ブランチの中身はマージされないので、記録もそちらに残すと消えるため。
  if (!note) fail("blocked / abandoned には --note で理由を書く");
  const dirty = await dirtyFiles();
  const bookkeepingOnly = dirty.every((file) => matchesAny(file, policy.bookkeepingPaths));
  if (dirty.length && !entry.worktree) fail(`未コミットの変更がある。調査用に WIP コミットしてから止める: ${dirty.slice(0, 5).join(", ")}`);
  if (entry.worktree) {
    entry.outcome = outcome;
    entry.finishedAt = new Date().toISOString();
    entry.notes.push(note);
    await writeFixes(fixes);
    const workNote = `自動修正を停止（${entry.fixId} / ${outcome}）: ${note}。隔離worktree ${entry.worktree} とブランチ ${branch} は残してある`;
    await writeRecoveryRecord(entry, workNote);
    await backlogMain(["update", entry.finding, "--tag", BLOCKED_TAG, "--work-note", workNote]);
    console.log(`${entry.fixId} ${outcome}。隔離worktreeとブランチを人が確認するまで保持する${bookkeepingOnly ? "" : "（修正差分あり）"}。mainで sync を実行して停止記録を回収する`);
    return;
  }
  await git(["switch", policy.baseBranch]);
  const baseFixes = await readFixes();
  baseFixes.push({ ...entry, outcome, finishedAt: new Date().toISOString(), notes: [...entry.notes, note] });
  await writeFixes(baseFixes);
  await backlogMain(["update", entry.finding, "--tag", BLOCKED_TAG, "--work-note", `自動修正を停止（${entry.fixId} / ${outcome}）: ${note}。ブランチ ${branch} は残してある`]);
  console.log(`${entry.fixId} ${outcome}。${policy.baseBranch} に戻り、${entry.finding} に ${BLOCKED_TAG} を付けた。ブランチ ${branch} は人が確認してから削除する`);
}

/* ------------------------------------------------------------------ sync */

// ブランチごとの最新記録だけを返す。台帳は追記型なので、同じブランチの古い行は履歴として残る。
export function latestFixes(fixes) {
  const latest = new Map();
  for (const fix of fixes) latest.set(fix.branch, fix);
  return [...latest.values()];
}

// PR の状態と発見事項の状態から、マージ後の台帳の結果を決める。変化が無ければ null。
//   pr-opened → merged | closed（PR の状態）
//   merged    → verified（発見事項が verified になっている）
export function reconcileFix(fix, { pr = null, findingStatus = null, at = new Date().toISOString() } = {}) {
  const next = { ...fix, notes: [...(fix.notes ?? [])] };
  if (next.outcome === "pr-opened" && pr) {
    if (pr.state === "MERGED") {
      Object.assign(next, { outcome: "merged", pr: pr.number ?? null, prUrl: pr.url ?? null, mergeCommit: pr.mergeCommit ?? null, mergedAt: pr.mergedAt ?? at });
    } else if (pr.state === "CLOSED") {
      Object.assign(next, { outcome: "closed", pr: pr.number ?? null, prUrl: pr.url ?? null, closedAt: at });
    }
  }
  if (next.outcome === "merged" && findingStatus === "verified") {
    Object.assign(next, { outcome: "verified", verifiedAt: at });
  }
  return next.outcome === fix.outcome ? null : next;
}

export function closedBookkeeping(fix, record) {
  const note = `自動修正 PR がマージされずに閉じられた（${fix.fixId} / #${fix.pr ?? "?"}）`;
  return {
    note,
    needsTag: !(record?.tags ?? []).includes(BLOCKED_TAG),
    needsNote: !(record?.workNotes ?? []).some((entry) => entry.note === note)
  };
}

// `Merge pull request #4 from owner/autofix/ux-035-test-hardening` の形の件名からブランチと PR 番号を読む。
export function parseMergeSubject(subject, branch) {
  const match = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)$/.exec(subject.trim());
  if (!match || match[2] !== branch) return null;
  return Number(match[1]);
}

async function lookupPr(branch, policy) {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "number,state,url,mergedAt,mergeCommit"], { cwd: REPO_ROOT });
    const [pr] = JSON.parse(stdout || "[]");
    if (pr) return { number: pr.number, state: pr.state, url: pr.url, mergedAt: pr.mergedAt || null, mergeCommit: pr.mergeCommit?.oid?.slice(0, 7) ?? null };
  } catch {
    // gh が無い・未ログインなら git のマージコミットだけで判定する（squash マージと close は見分けられない）
  }
  const log = await git(["log", policy.baseBranch, "--merges", "--format=%h%x09%cI%x09%s"], { allowFailure: true });
  for (const line of (log ?? "").split("\n")) {
    const [mergeCommit, mergedAt, subject = ""] = line.split("\t");
    const number = parseMergeSubject(subject, branch);
    if (number) return { number, state: "MERGED", url: null, mergedAt, mergeCommit };
  }
  return null;
}

async function recoverStoppedFixes({ dryRun = false } = {}) {
  const recovery = await readRecoveryRecords();
  if (dryRun || !recovery.length) return recovery.map(({ entry }) => ({ fixId: entry.fixId, finding: entry.finding, branch: entry.branch, from: "recovery", to: entry.outcome, changed: true, recovery: true }));
  const fixes = await readFixes();
  for (const row of recovery) {
    const { entry, workNote, file } = row;
    if (!fixes.some((fix) => fix.fixId === entry.fixId && fix.outcome === entry.outcome && fix.worktree === entry.worktree)) {
      fixes.push(entry);
      await writeFixes(fixes);
    }
    const records = await readFindings();
    const record = records.find((candidate) => candidate.id === entry.finding);
    const args = ["update", entry.finding];
    if (!(record?.tags ?? []).includes(BLOCKED_TAG)) args.push("--tag", BLOCKED_TAG);
    if (!(record?.workNotes ?? []).some((item) => item.note === workNote)) args.push("--work-note", workNote);
    if (args.length > 2) await backlogMain(args);
    await fs.rm(file, { force: true });
  }
  return recovery.map(({ entry }) => ({ fixId: entry.fixId, finding: entry.finding, branch: entry.branch, from: "recovery", to: entry.outcome, changed: true, recovery: true }));
}

async function commandSync(options) {
  const policy = await readPolicy();
  const dryRun = options.has("dry-run");
  if (!dryRun) {
    const branch = await currentBranch();
    if (branch !== policy.baseBranch) fail(`${policy.baseBranch} 上で実行する（現在: ${branch}）。台帳はマージ先に記録する`);
  }
  const recovered = await recoverStoppedFixes({ dryRun });
  const fixes = await readFixes();
  const records = await readFindings();
  const pending = latestFixes(fixes).filter((fix) => {
    if (["pr-opened", "merged"].includes(fix.outcome)) return true;
    if (fix.outcome !== "closed") return false;
    const bookkeeping = closedBookkeeping(fix, records.find((record) => record.id === fix.finding));
    return bookkeeping.needsTag || bookkeeping.needsNote;
  });
  if (!pending.length) {
    console.log(options.has("json") ? JSON.stringify(recovered, null, 2) : recovered.length ? `停止記録 ${recovered.length} 件をmainへ回収した` : "マージ待ち・検証待ちの自動修正はない");
    return;
  }
  const at = new Date().toISOString();
  const results = [];
  for (const fix of pending) {
    const pr = fix.outcome === "pr-opened" ? await lookupPr(fix.branch, policy) : null;
    const findingStatus = records.find((record) => record.id === fix.finding)?.status ?? null;
    results.push({ fix, next: reconcileFix(fix, { pr, findingStatus, at }), pr });
  }
  const changed = results.filter((result) => result.next);
  if (!dryRun && changed.length) {
    for (const { fix, next } of changed) fixes[fixes.lastIndexOf(fix)] = next;
    await writeFixes(fixes);
  }
  if (!dryRun) {
    // PR が閉じられた＝人が不採用にした。部分失敗後の再実行でも不足分だけ補う。
    for (const { fix, next } of results) {
      const effective = next ?? fix;
      if (effective.outcome !== "closed") continue;
      const record = records.find((entry) => entry.id === effective.finding);
      const bookkeeping = closedBookkeeping(effective, record);
      const args = ["update", effective.finding];
      if (bookkeeping.needsTag) args.push("--tag", BLOCKED_TAG);
      if (bookkeeping.needsNote) args.push("--work-note", bookkeeping.note);
      if (args.length > 2) await backlogMain(args);
    }
  }
  if (options.has("json")) {
    console.log(JSON.stringify([...recovered, ...results.map(({ fix, next }) => ({ fixId: fix.fixId, finding: fix.finding, branch: fix.branch, from: fix.outcome, to: next?.outcome ?? fix.outcome, changed: Boolean(next), pr: next?.pr ?? fix.pr ?? null }))], null, 2));
    return;
  }
  for (const { fix, next, pr } of results) {
    const to = next?.outcome ?? fix.outcome;
    const number = next?.pr ?? fix.pr ?? pr?.number;
    console.log(`${dryRun && next ? "[DRY] " : ""}${fix.fixId} ${fix.finding} ${next ? `${fix.outcome} → ${to}` : `${fix.outcome}（変化なし）`}${number ? ` PR #${number}` : ""}`);
    if (to === "merged") console.log(`  次: npm run backlog:verify -- ${fix.finding} --method code --result passed、backlog:update --status verified の後にもう一度 sync`);
    if (to === "closed") console.log(`  ${fix.finding} に ${BLOCKED_TAG} を付ける。ブランチ ${fix.branch} は人が確認してから削除する`);
  }
  if (!dryRun && changed.length) console.log(`台帳を更新した。${REVIEW_CONFIG.paths.fixes}（closed があれば findings / report も）を確認してコミットする`);
}

export function renderPrBody(record, fix, policy) {
  const classPolicy = policy.classes[fix.fixClass];
  return [
    `自動修正ゲート（\`review/autofix-policy.json\`）を通過した修正。区分: **${fix.fixClass}**（${classPolicy?.title ?? "—"}）`,
    "",
    `## ${record.id} — ${record.title}`,
    "",
    record.finding,
    "",
    "### 受入条件",
    "",
    ...(record.acceptanceCriteria ?? []).map((criterion) => `- [ ] ${criterion}`),
    "",
    "### ゲート結果",
    "",
    `- 変更: ${fix.gate?.files ?? "?"} ファイル / ${fix.gate?.lines ?? "?"} 行（上限 ${policy.limits.maxChangedFiles} / ${policy.limits.maxChangedLines}）`,
    `- 検証: ${fix.gate?.verified ? policy.verify.join(" && ") : "未実行"}`,
    `- 台帳: ${fix.fixId}（base ${fix.baseCommit}）`,
    "",
    "### レビューで見ること",
    "",
    "- 受入条件を満たしているか（ゲートは範囲と量しか見ていない）",
    "- 提案の外へ手を広げていないか",
    `- マージ後に \`npm run backlog:verify -- ${record.id} --method code --result passed\` と \`npm run backlog:update -- ${record.id} --status verified\` で検証を記録し、\`npm run review:autofix -- sync\` で台帳へ反映する`,
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    ""
  ].join("\n");
}

async function commandPrBody(options) {
  const policy = await readPolicy();
  const branch = await currentBranch();
  const parsed = parseBranchName(branch, policy);
  if (!parsed) fail(`自動修正ブランチ上で実行する（現在: ${branch}）`);
  const record = (await readFindings()).find((entry) => entry.id === parsed.findingId);
  if (!record) fail(`unknown finding: ${parsed.findingId}`);
  const fix = [...(await readFixes())].reverse().find((entry) => entry.branch === branch);
  if (!fix) fail(`台帳に ${branch} の記録がない`);
  const title = `fix(autofix): ${record.title}（${record.id}）`;
  const body = renderPrBody(record, fix, policy);
  if (options.has("json")) {
    console.log(JSON.stringify({ title, body, branch, base: policy.baseBranch }, null, 2));
    return;
  }
  const out = value(options, "out");
  if (out) {
    await fs.writeFile(path.resolve(out), body, "utf8");
    console.log(title);
    return;
  }
  console.log(`${title}\n\n${body}`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, positionals, options } = parseArgs(argv);
  switch (command) {
    case "candidates": await commandCandidates(options); break;
    case "start": await commandStart(positionals, options); break;
    case "_activate": await commandActivate(positionals, options); break;
    case "gate": await commandGate(options); break;
    case "finish": await commandFinish(positionals, options); break;
    case "pr-body": await commandPrBody(options); break;
    case "sync": await commandSync(options); break;
    default: fail(`unknown command: ${command}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`review-autofix: ${error.message}`);
    process.exitCode = 1;
  });
}
