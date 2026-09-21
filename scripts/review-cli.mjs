// 自動レビューの日常操作をまとめる共通 CLI。
// doctor は読み取り専用で、問題を直さず影響と人が行う対処を示す。
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { IMMUTABLE_EXCLUDE, loadReviewConfig, resolveReviewPaths } from "./review-config-core.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.REVIEW_REPO_ROOT ? path.resolve(process.env.REVIEW_REPO_ROOT) : path.resolve(SCRIPT_DIR, "..");
const CONFIG_FILE = process.env.REVIEW_CONFIG_FILE ? path.resolve(process.env.REVIEW_CONFIG_FILE) : path.join(REPO_ROOT, "review.config.json");
const PACKAGE_FILE = path.join(REPO_ROOT, "package.json");
const CYCLE_SCRIPT = path.join(SCRIPT_DIR, "review-cycle.mjs");
const BACKLOG_SCRIPT = path.join(SCRIPT_DIR, "backlog.mjs");
let REVIEW_CONFIG;
let REVIEW_PATHS;
let LOCK_FILE;

function fail(message) {
  throw new Error(message);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function result(level, id, summary, impact, action = null, details = {}) {
  return { level, id, summary, impact, action, ...details };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readJsonl(file) {
  try {
    const content = await fs.readFile(file, "utf8");
    return content.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path.relative(REPO_ROOT, file)} line ${index + 1}: ${error.message}`, { cause: error });
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${path.relative(REPO_ROOT, file)} が存在しない`, { cause: error });
    throw error;
  }
}

async function command(file, args = [], { allowFailure = false, timeout = 10_000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd: REPO_ROOT,
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (error) {
    if (!allowFailure) throw error;
    return {
      ok: false,
      stdout: String(error.stdout ?? "").trim(),
      stderr: String(error.stderr ?? error.message ?? "").trim(),
      code: error.code ?? 1
    };
  }
}

async function nodeScript(file, args = [], options = {}) {
  return command(process.execPath, [file, ...args], { timeout: 120_000, ...options });
}

async function git(args, options = {}) {
  return command("git", ["-c", `safe.directory=${REPO_ROOT.replaceAll("\\", "/")}`, ...args], options);
}

export function parseMajor(version) {
  const match = String(version).match(/v?(\d+)/);
  return match ? Number(match[1]) : null;
}

export function parseMinimumNode(range) {
  const match = String(range ?? "").match(/>=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

export function verificationCommandIssue(spec, packageJson, root = REPO_ROOT) {
  const tokens = String(spec).trim().split(/\s+/);
  if (!tokens[0]) return "空のコマンド";
  if (["npm", "npm.cmd"].includes(tokens[0]) && tokens[1] === "run") {
    const script = tokens[2];
    if (!script) return "npm run のスクリプト名がない";
    if (!packageJson.scripts?.[script]) return `package.json に scripts.${script} がない`;
    return null;
  }
  if (tokens[0] === "node" && tokens[1] && /[\\/]|\.[cm]?js$/.test(tokens[1])) {
    const target = path.resolve(root, tokens[1]);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return "node の対象がリポジトリ外にある";
    if (!existsSync(target)) return `node の対象が存在しない: ${tokens[1]}`;
    return null;
  }
  return `未対応の検証コマンド形式: ${tokens[0]}`;
}

export function lockStatus(lock, now = Date.now(), staleMinutes = 60) {
  const started = Date.parse(lock?.startedAt);
  const ageMinutes = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 60_000)) : null;
  const localHosts = [process.env.COMPUTERNAME, process.env.HOSTNAME].filter(Boolean).map((value) => value.toLowerCase());
  const sameHost = !lock?.host || localHosts.includes(String(lock.host).toLowerCase());
  let alive = sameHost ? false : null;
  if (sameHost && Number.isInteger(lock?.pid)) {
    try {
      process.kill(lock.pid, 0);
      alive = true;
    } catch (error) {
      alive = error.code === "EPERM";
    }
  }
  return {
    pid: Number.isInteger(lock?.pid) ? lock.pid : null,
    startedAt: lock?.startedAt ?? null,
    host: lock?.host ?? null,
    sameHost,
    ageMinutes,
    alive,
    stale: sameHost && ageMinutes !== null && ageMinutes >= staleMinutes && alive === false
  };
}

export function validateRunLedger(runs) {
  const outcomes = new Set(["running", "ok", "empty", "capped", "failed", "aborted"]);
  const ids = new Set();
  for (const [index, run] of runs.entries()) {
    if (!run || typeof run !== "object" || Array.isArray(run)) fail(`run ${index + 1} must be an object`);
    for (const field of ["runId", "lens", "startedAt", "outcome"]) if (run[field] === undefined) fail(`run ${index + 1} is missing ${field}`);
    if (ids.has(run.runId)) fail(`duplicate runId: ${run.runId}`);
    ids.add(run.runId);
    if (!outcomes.has(run.outcome)) fail(`${run.runId}.outcome is invalid: ${run.outcome}`);
    if (Number.isNaN(Date.parse(run.startedAt))) fail(`${run.runId}.startedAt is invalid`);
    if (run.outcome === "running" && run.finishedAt !== null) fail(`${run.runId} running must have finishedAt null`);
    if (run.outcome !== "running" && Number.isNaN(Date.parse(run.finishedAt))) fail(`${run.runId} closed run needs finishedAt`);
    for (const field of ["added", "updated", "suppressed", "notes"]) if (!Array.isArray(run[field])) fail(`${run.runId}.${field} must be an array`);
  }
  return runs;
}

export function validateFixLedger(fixes) {
  const outcomes = new Set(["running", "gate-passed", "gate-failed", "pr-opened", "merged", "verified", "closed", "blocked", "abandoned"]);
  for (const [index, fix] of fixes.entries()) {
    if (!fix || typeof fix !== "object" || Array.isArray(fix)) fail(`fix ${index + 1} must be an object`);
    for (const field of ["fixId", "finding", "branch", "outcome"]) if (typeof fix[field] !== "string" || !fix[field]) fail(`fix ${index + 1} has invalid ${field}`);
    if (!outcomes.has(fix.outcome)) fail(`${fix.fixId}.outcome is invalid: ${fix.outcome}`);
    if (fix.notes !== undefined && !Array.isArray(fix.notes)) fail(`${fix.fixId}.notes must be an array`);
  }
  return fixes;
}

export function scopeOverlaps(policy, files) {
  return Object.entries(policy.classes).map(([fixClass, classPolicy]) => {
    const overlapping = files.filter((file) => matchesAny(file, classPolicy.scope) && matchesAny(file, policy.forbiddenPaths));
    const allowed = files.filter((file) => matchesAny(file, classPolicy.scope) && !matchesAny(file, policy.forbiddenPaths));
    return { fixClass, overlapping, allowedCount: allowed.length };
  });
}

export function parseWorktreePorcelain(content) {
  const entries = [];
  let current = null;
  for (const line of String(content).split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length), branch: null, head: null };
    } else if (current && line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (current && line.startsWith("branch refs/heads/")) current.branch = line.slice("branch refs/heads/".length);
  }
  if (current) entries.push(current);
  return entries;
}

export function worktreeConsistencyProblems(worktrees, branches, baseFixes = []) {
  const problems = [];
  const worktreeBranches = new Set(worktrees.map((entry) => entry.branch));
  const terminal = new Set(["blocked", "abandoned", "closed", "merged", "verified"]);
  for (const branch of branches.filter((entry) => !worktreeBranches.has(entry))) {
    const fix = [...baseFixes].reverse().find((entry) => entry.branch === branch);
    if (!fix || !terminal.has(fix.outcome)) problems.push(`${branch}: branchはあるが登録済みworktreeがない`);
  }
  const registeredPaths = new Set(worktrees.map((entry) => path.resolve(entry.path)));
  for (const fix of baseFixes.filter((entry) => entry.worktree && !terminal.has(entry.outcome))) {
    if (!registeredPaths.has(path.resolve(fix.worktree))) problems.push(`${fix.branch}: fix台帳のworktreeがGit登録から消えている (${fix.worktree})`);
  }
  return problems;
}

function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        const skipSlash = pattern[index + 2] === "/";
        index += skipSlash ? 2 : 1;
        source += skipSlash ? "(?:.*/)?" : ".*";
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

function parseGitHubRepo(remote) {
  const match = String(remote).match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function diagnoseLedgers(results) {
  const [{ readLenses }, { parseRuns }, { parseFixes, readPolicy }, { validateRecords }] = await Promise.all([
    import("./review-lenses.mjs"),
    import("./review-cycle.mjs"),
    import("./review-autofix.mjs"),
    import("./backlog.mjs")
  ]);
  const checks = [
    ["lenses", async () => readLenses(), REVIEW_CONFIG.paths.lenses],
    ["findings", async () => validateRecords(await readJsonl(REVIEW_PATHS.findings)), REVIEW_CONFIG.paths.findings],
    ["runs", async () => validateRunLedger(parseRuns(await fs.readFile(REVIEW_PATHS.runs, "utf8"))), REVIEW_CONFIG.paths.runs],
    ["fixes", async () => validateFixLedger(parseFixes(await fs.readFile(REVIEW_PATHS.fixes, "utf8"))), REVIEW_CONFIG.paths.fixes],
    ["autofix-policy", async () => readPolicy(), REVIEW_CONFIG.paths.autofixPolicy]
  ];
  const values = {};
  for (const [id, inspect, relative] of checks) {
    try {
      const value = await inspect();
      values[id] = value;
      results.push(result("ok", `schema:${id}`, `${relative} のスキーマは有効`, "通常操作を続行できる", null, { count: Array.isArray(value) ? value.length : 1 }));
    } catch (error) {
      results.push(result("error", `schema:${id}`, `${relative} を検証できない: ${error.message}`, "台帳を安全に読み書きできない", `${relative} のJSON/JSONLと必須フィールドを修正する`));
    }
  }
  return values;
}

async function diagnoseEnvironment(results, packageJson) {
  const requiredNode = parseMinimumNode(packageJson.engines?.node);
  const actualNode = parseMajor(process.version);
  if (requiredNode && actualNode !== null && actualNode < requiredNode) {
    results.push(result("error", "env:node", `Node ${process.version} は必要条件 ${packageJson.engines.node} を満たさない`, "レビューCLIや検証が互換性のないNodeで失敗する", `Node ${requiredNode} 以上へ切り替える`));
  } else {
    results.push(result("ok", "env:node", `Node ${process.version}`, "実行条件を満たしている"));
  }

  const gitVersion = await git(["--version"], { allowFailure: true });
  results.push(gitVersion.ok
    ? result("ok", "env:git", gitVersion.stdout, "Git診断を実行できる")
    : result("error", "env:git", "Gitを実行できない", "差分走査とブランチ安全確認ができない", "GitをPATHへ追加する"));

  const ghVersion = await command("gh", ["--version"], { allowFailure: true });
  if (!ghVersion.ok) {
    results.push(result("warn", "env:gh", "GitHub CLIを実行できない", "PR状態・ブランチ保護・Actions権限を自動確認できない", "GitHub CLIを導入し gh auth login を完了する"));
    return false;
  }
  const ghAuth = await command("gh", ["auth", "status"], { allowFailure: true });
  results.push(ghAuth.ok
    ? result("ok", "env:gh", ghVersion.stdout.split(/\r?\n/)[0], "GitHubの読み取り診断を実行できる")
    : result("warn", "env:gh-auth", "GitHub CLIはあるが認証を確認できない", "remote側の保護設定とPR状態を確認できない", "gh auth login または gh auth status で認証を確認する"));
  return ghAuth.ok;
}

async function diagnoseGit(results) {
  const branch = await git(["branch", "--show-current"], { allowFailure: true });
  const status = await git(["status", "--porcelain"], { allowFailure: true });
  const remote = await git(["remote", "get-url", "origin"], { allowFailure: true });
  if (!branch.ok || !status.ok) {
    results.push(result("error", "git:worktree", "現在のブランチまたは作業ツリーを確認できない", "安全な実行基点を判断できない", "Gitリポジトリと所有権を確認する"));
  } else {
    results.push(result("ok", "git:branch", `現在のブランチ: ${branch.stdout || "detached HEAD"}`, "実行基点を確認できた", null, { branch: branch.stdout || null }));
    const dirty = status.stdout.split(/\r?\n/).filter(Boolean);
    results.push(dirty.length
      ? result("warn", "git:worktree", `作業ツリーに ${dirty.length} 件の変更がある`, "自動修正は開始しないが、レビュー範囲へ未コミット変更が含まれる", "意図した変更か確認し、必要なら先にコミットする", { dirty })
      : result("ok", "git:worktree", "作業ツリーはclean", "差分の帰属が明確"));
  }
  if (!remote.ok || !remote.stdout) {
    results.push(result("warn", "git:remote", "origin remote を確認できない", "GitHub側の保護設定を診断できない", "origin を設定するか手動でremote設定を確認する"));
    return null;
  }
  results.push(result("ok", "git:remote", `origin: ${remote.stdout}`, "remoteを確認できた"));
  return parseGitHubRepo(remote.stdout);
}

async function diagnoseLock(results, runs) {
  let raw;
  try {
    raw = await fs.readFile(LOCK_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      results.push(result("error", "lock:file", `lockを読めない: ${error.message}`, "同時実行の安全性を確認できない", `${path.relative(REPO_ROOT, LOCK_FILE)} の権限を確認する`));
      return;
    }
  }
  if (raw !== undefined) {
    try {
      const status = lockStatus(JSON.parse(raw));
      const level = status.sameHost && status.alive === false && !status.stale ? "error" : "warn";
      const action = !status.sameHost
        ? "別ホストの保持者に完了状況を確認する。PIDをこのホストで照合せず、勝手にlockを削除しない"
        : status.stale
        ? "保持プロセスが無いことを再確認し、reviewコマンドの --force-unlock を人が明示して実行する"
        : "保持プロセスの完了を待つ。勝手にlockを削除しない";
      results.push(result(level, "lock:file", `lockあり: pid=${status.pid ?? "?"}, host=${status.host ?? "?"}, age=${status.ageMinutes ?? "?"}分, alive=${status.alive ?? "unknown"}`, "別のレビュー操作と競合する可能性がある", action, { lock: status }));
    } catch (error) {
      results.push(result("error", "lock:file", `lockのJSONが不正: ${error.message}`, "保持者と経過時間を判断できない", "実行中プロセスの有無を確認してからlockを修復する"));
    }
  } else {
    results.push(result("ok", "lock:file", "lockは保持されていない", "新しいレビュー操作を開始できる"));
  }
  const running = Array.isArray(runs) ? runs.filter((entry) => entry.outcome === "running") : [];
  results.push(running.length
    ? result("warn", "lock:runs", `running のrunが ${running.length} 件残っている`, "前回の異常終了または未完了サイクルの可能性がある", "各runを確認し、review finish で failed または aborted として閉じる。doctorは削除しない", { runIds: running.map((entry) => entry.runId) })
    : result("ok", "lock:runs", "running のrunは残っていない", "前回サイクルは台帳上終了している"));
}

async function diagnoseVerification(results, packageJson) {
  for (const spec of REVIEW_CONFIG.verification) {
    const issue = verificationCommandIssue(spec, packageJson);
    results.push(issue
      ? result("error", `verification:${spec}`, `${spec}: ${issue}`, "必須検証を実行できない", "review.config.json または package.json のコマンドを修正する")
      : result("ok", `verification:${spec}`, `${spec} を解決できる`, "自動修正ゲートが呼び出せる"));
  }
}

async function diagnoseScopes(results, policy) {
  if (!policy) return;
  const tracked = await git(["ls-files"], { allowFailure: true });
  if (!tracked.ok) {
    results.push(result("error", "autofix:scope", "追跡ファイルを列挙できない", "禁止パスと自動修正範囲の重なりを確認できない", "Gitの状態を修復してdoctorを再実行する"));
    return;
  }
  const files = tracked.stdout.split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/"));
  for (const overlap of scopeOverlaps(policy, files)) {
    if (!overlap.allowedCount) {
      results.push(result("error", `autofix:scope:${overlap.fixClass}`, `${overlap.fixClass} の許可範囲がすべて禁止パスと重なる`, "この区分は安全に変更対象を選べない", "区分のscopeを狭めるか、禁止境界を維持したまま区分を無効化する", overlap));
    } else if (overlap.overlapping.length) {
      results.push(result("warn", `autofix:scope:${overlap.fixClass}`, `${overlap.fixClass}: 禁止優先の重なり ${overlap.overlapping.length} 件`, "重なったファイルはゲートで拒否され、区分の修正可能範囲が狭まる", "意図した安全境界か確認する。禁止パスは緩めない", overlap));
    } else {
      results.push(result("ok", `autofix:scope:${overlap.fixClass}`, `${overlap.fixClass}: 禁止パスとの重なりなし`, "許可範囲が明確", null, overlap));
    }
  }
  if (!IMMUTABLE_EXCLUDE.every((pattern) => policy.forbiddenPaths.includes(pattern))) {
    results.push(result("error", "autofix:immutable", "エンジン固定の禁止パスが方針へ反映されていない", "設定で安全下限を緩められる可能性がある", "validatePolicy の固定禁止パス統合を修復する"));
  } else {
    results.push(result("ok", "autofix:immutable", "エンジン固定の禁止パスは有効", "設定だけでは安全下限を解除できない"));
  }
}

async function diagnoseAutofixWorktrees(results, policy, baseFixes = []) {
  if (!policy) return;
  const listed = await git(["worktree", "list", "--porcelain"], { allowFailure: true });
  if (!listed.ok) {
    results.push(result("error", "autofix:worktrees", "Git worktreeを列挙できない", "中断した自動修正の場所を確認できない", "git worktree list --porcelain を手動実行してGit状態を修復する"));
    return;
  }
  const worktrees = parseWorktreePorcelain(listed.stdout).filter((entry) => entry.branch?.startsWith(policy.branchPrefix));
  const problems = [];
  for (const worktree of worktrees) {
    const ledger = path.join(worktree.path, ...REVIEW_CONFIG.paths.fixes.split("/"));
    try {
      const fixes = validateFixLedger((await fs.readFile(ledger, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
      const match = [...fixes].reverse().find((entry) => entry.branch === worktree.branch && path.resolve(entry.worktree ?? "") === path.resolve(worktree.path));
      if (!match) problems.push(`${worktree.branch}: worktreeとfix台帳の対応がない (${worktree.path})`);
    } catch (error) {
      problems.push(`${worktree.branch}: fix台帳を検証できない (${error.message})`);
    }
  }
  const common = await git(["rev-parse", "--git-common-dir"], { allowFailure: true });
  let locks = [];
  let recovery = [];
  if (common.ok) {
    const commonDirectory = path.resolve(REPO_ROOT, common.stdout);
    locks = await fs.readdir(path.join(commonDirectory, "review-autofix-locks")).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    recovery = await fs.readdir(path.join(commonDirectory, "review-autofix-recovery")).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  }
  const branchesResult = await git(["branch", "--list", `${policy.branchPrefix}*`, "--format=%(refname:short)"], { allowFailure: true });
  const branches = branchesResult.ok ? branchesResult.stdout.split(/\r?\n/).filter(Boolean) : [];
  problems.push(...worktreeConsistencyProblems(worktrees, branches, baseFixes));
  if (problems.length || locks.length || recovery.length) {
    results.push(result("warn", "autofix:worktrees", `隔離worktreeに確認事項がある: 不整合 ${problems.length}件 / lock ${locks.length}件 / 回収待ち ${recovery.length}件`, "中断した処理または台帳不整合の可能性がある", "worktree・branch・owner.json・fix台帳を照合し、mainでreview syncを実行してから、PR状態と未回収差分を確認して明示的に片付ける", { worktrees, branches, problems, locks, recovery }));
  } else {
    results.push(result("ok", "autofix:worktrees", `隔離worktree ${worktrees.length}件の対応関係は有効`, "中断残骸は見つからない", null, { worktrees, branches }));
  }
}

async function diagnoseGitHub(results, repo, branch, authenticated) {
  if (!repo || !authenticated) return;
  const protection = await command("gh", ["api", `repos/${repo}/branches/${branch}/protection`], { allowFailure: true });
  const protectionIssue = protection.ok ? githubBranchProtectionIssue(protection.stdout) : null;
  results.push(protection.ok && !protectionIssue
    ? result("ok", "github:branch-protection", `${branch} の必須ステータスチェックを確認できた`, "基点ブランチのremote側ゲートが有効")
    : result("warn", "github:branch-protection", protectionIssue ? `${branch} のブランチ保護が不十分: ${protectionIssue}` : `${branch} のブランチ保護を取得できない`, "自動修正PRが必要なゲートを通らずマージされる可能性がある", `GitHubで ${repo} の ${branch} branch protection/ruleset と必須チェックを手動確認する`));
  const actions = await command("gh", ["api", `repos/${repo}/actions/permissions/workflow`], { allowFailure: true });
  const actionsIssue = actions.ok ? githubWorkflowPermissionsIssue(actions.stdout) : null;
  results.push(actions.ok && !actionsIssue
    ? result("ok", "github:actions-permissions", "Actions workflow権限の設定を確認できた", "workflowの明示的なjob権限を評価できる")
    : result("warn", "github:actions-permissions", actionsIssue ? `Actions workflow権限の応答が不正: ${actionsIssue}` : "Actions workflow権限を取得できない", "PR作成・台帳更新に必要な権限を自動確認できない", `GitHubの ${repo} Settings > Actions > General で workflow permissions を手動確認する`));
}

export function githubBranchProtectionIssue(content) {
  let payload;
  try { payload = JSON.parse(content); } catch { return "JSONとして解釈できない"; }
  const checks = payload?.required_status_checks?.contexts ?? payload?.required_status_checks?.checks?.map((entry) => entry.context);
  if (!Array.isArray(checks) || !checks.filter(Boolean).length) return "必須ステータスチェックが設定されていない";
  return null;
}

export function githubWorkflowPermissionsIssue(content) {
  let payload;
  try { payload = JSON.parse(content); } catch { return "JSONとして解釈できない"; }
  if (!['read', 'write'].includes(payload?.default_workflow_permissions)) return "default_workflow_permissions が不明";
  if (typeof payload?.can_approve_pull_request_reviews !== "boolean") return "can_approve_pull_request_reviews が不明";
  return null;
}

export async function runDoctor() {
  const results = [];
  let packageJson = {};
  try {
    packageJson = await readJson(PACKAGE_FILE);
    results.push(result("ok", "package", "package.json は有効", "実行条件と検証コマンドを診断できる"));
  } catch (error) {
    results.push(result("error", "package", `package.json を検証できない: ${error.message}`, "Node要件と検証コマンドを確定できない", "package.json のJSONと必須scriptsを修正する"));
  }
  try {
    REVIEW_CONFIG = await loadReviewConfig({ file: CONFIG_FILE, root: REPO_ROOT });
    REVIEW_PATHS = resolveReviewPaths(REVIEW_CONFIG, REPO_ROOT);
    LOCK_FILE = `${REVIEW_PATHS.runs}.lock`;
    results.push(result("ok", "config", "review.config.json のスキーマとパス境界は有効", "設定を読み込める"));
  } catch (error) {
    results.push(result("error", "config", `review.config.json を検証できない: ${error.message}`, "台帳の場所と安全境界を確定できないため、レビュー操作を開始できない", "設定のJSON、必須キー、相対パスを修正してdoctorを再実行する"));
    await diagnoseEnvironment(results, packageJson);
    await diagnoseGit(results);
    return { ok: false, generatedAt: new Date().toISOString(), root: REPO_ROOT, results };
  }
  const ledgers = await diagnoseLedgers(results);
  const authenticated = await diagnoseEnvironment(results, packageJson);
  const repo = await diagnoseGit(results);
  await diagnoseLock(results, ledgers.runs);
  await diagnoseVerification(results, packageJson);
  await diagnoseScopes(results, ledgers["autofix-policy"]);
  await diagnoseAutofixWorktrees(results, ledgers["autofix-policy"], ledgers.fixes);
  const baseBranch = ledgers["autofix-policy"]?.baseBranch ?? "main";
  await diagnoseGitHub(results, repo, baseBranch, authenticated);
  return {
    ok: !results.some((entry) => entry.level === "error"),
    generatedAt: new Date().toISOString(),
    root: REPO_ROOT,
    results
  };
}

export function renderDoctor(report) {
  const labels = { ok: "OK", warn: "WARN", error: "ERROR" };
  const lines = [`review doctor: ${report.ok ? "続行可能" : "要修復"}`, ""];
  for (const entry of report.results) {
    lines.push(`[${labels[entry.level]}] ${entry.summary}`);
    lines.push(`  影響: ${entry.impact}`);
    if (entry.action) lines.push(`  対処: ${entry.action}`);
  }
  const counts = Object.fromEntries(["ok", "warn", "error"].map((level) => [level, report.results.filter((entry) => entry.level === level).length]));
  lines.push("", `合計: OK ${counts.ok} / WARN ${counts.warn} / ERROR ${counts.error}`);
  return lines.join("\n");
}

function parseEvidenceInput(value, index) {
  if (typeof value === "string") return nonEmptyString(value, `findings[${index}].evidence`);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`findings[${index}].evidence must contain strings or objects`);
  const file = nonEmptyString(value.file, `findings[${index}].evidence.file`);
  const lines = value.lines === undefined ? "" : `:${nonEmptyString(String(value.lines), `findings[${index}].evidence.lines`)}`;
  return `${file}${lines}`;
}

export function normalizeRunFinding(value, index, lens, config = REVIEW_CONFIG) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`findings[${index}] must be an object`);
  const category = value.category ?? lens.category;
  const app = value.app ?? lens.app;
  const area = value.area ?? lens.area;
  if (!config.vocabulary.categories.includes(category)) fail(`findings[${index}].category is invalid: ${category}`);
  if (!config.vocabulary.components.includes(app)) fail(`findings[${index}].app is invalid: ${app}`);
  if (!config.vocabulary.areas.includes(area)) fail(`findings[${index}].area is invalid: ${area}`);
  const priority = value.priority ?? "P2";
  if (!["P1", "P2", "P3"].includes(priority)) fail(`findings[${index}].priority is invalid: ${priority}`);
  const verificationRequired = value.verificationRequired ?? (lens.mode === "deterministic" ? "code" : "manual");
  if (!["code", "manual", "both"].includes(verificationRequired)) fail(`findings[${index}].verificationRequired is invalid: ${verificationRequired}`);
  const evidence = (value.evidence ?? []).map((entry) => parseEvidenceInput(entry, index));
  if (!evidence.length) fail(`findings[${index}].evidence must not be empty`);
  return {
    category,
    app,
    area,
    priority,
    title: nonEmptyString(value.title, `findings[${index}].title`),
    finding: nonEmptyString(value.finding, `findings[${index}].finding`),
    impact: nonEmptyString(value.impact, `findings[${index}].impact`),
    proposal: nonEmptyString(value.proposal, `findings[${index}].proposal`),
    verificationRequired,
    evidence,
    acceptanceCriteria: (value.acceptanceCriteria ?? []).map((entry) => nonEmptyString(entry, `findings[${index}].acceptanceCriteria`)),
    tags: (value.tags ?? []).map((entry) => nonEmptyString(entry, `findings[${index}].tags`))
  };
}

function deterministicFindings(plan, results) {
  const byFile = new Map();
  for (const issue of results.flatMap((check) => check.issues)) {
    const entries = byFile.get(issue.file) ?? [];
    entries.push(issue);
    byFile.set(issue.file, entries);
  }
  return [...byFile.entries()].map(([file, issues]) => ({
    category: plan.category,
    app: plan.app,
    area: plan.area,
    priority: "P2",
    title: `${plan.title}: ${file}`,
    finding: issues.map((issue) => issue.message).join(" / "),
    impact: `${file} が ${plan.title} の決定論チェックに違反している`,
    proposal: [...new Set(issues.map((issue) => issue.hint))].join(" / "),
    evidence: issues.map((issue) => `${file}${issue.line ? `:${issue.line}` : ""}`),
    verificationRequired: "code"
  }));
}

async function readRunFindings(file, plan) {
  if (plan.mode === "deterministic") {
    if (file) fail("deterministic lens does not accept --findings; the configured check is the source of truth");
    const { runChecks } = await import("./review-checks.mjs");
    const results = await runChecks([plan.check], { root: REPO_ROOT, files: plan.files });
    return deterministicFindings(plan, results);
  }
  if (!file) fail("LLM lens requires --findings <json-file>; use [] when the review found nothing");
  const absolute = path.resolve(REPO_ROOT, file);
  const relative = path.relative(REPO_ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`--findings must stay inside the repository: ${file}`);
  const parsed = JSON.parse(await fs.readFile(absolute, "utf8"));
  if (!Array.isArray(parsed)) fail("--findings JSON must be an array");
  return parsed;
}

function findingArgs(runId, finding) {
  const args = [
    "add", "--run", runId, "--json",
    "--category", finding.category,
    "--app", finding.app,
    "--area", finding.area,
    "--priority", finding.priority,
    "--title", finding.title,
    "--finding", finding.finding,
    "--impact", finding.impact,
    "--proposal", finding.proposal,
    "--verification-required", finding.verificationRequired
  ];
  for (const evidence of finding.evidence) args.push("--evidence", evidence);
  for (const criterion of finding.acceptanceCriteria) args.push("--acceptance-criteria", criterion);
  for (const tag of finding.tags) args.push("--tag", tag);
  return args;
}

function finishArgs(runId, outcome, registrations, notes = []) {
  const args = ["finish", runId, "--outcome", outcome];
  for (const entry of registrations) {
    const option = entry.outcome === "added" ? "--added" : entry.outcome === "re-detected" ? "--updated" : "--suppressed";
    args.push(option, entry.id);
  }
  for (const note of notes) args.push("--note", note);
  return args;
}

function evidenceFile(value) {
  return value.replace(/:\d+(?:-\d+)?$/, "").replaceAll("\\", "/");
}

export function validateFindingScope(findings, plan) {
  const allowed = new Set(plan.files.map((file) => file.replaceAll("\\", "/")));
  for (const [index, finding] of findings.entries()) {
    for (const evidence of finding.evidence) {
      const file = evidenceFile(evidence);
      if (!allowed.has(file)) fail(`findings[${index}].evidence is outside plan.files: ${file}`);
    }
  }
  return findings;
}

export function sameExecutionPlan(planned, started) {
  return planned.lens === started.lens
    && planned.base === started.base
    && planned.head === started.head
    && JSON.stringify(planned.files) === JSON.stringify(started.files);
}

function interruptedError(signal) {
  const error = new Error(`review run interrupted by ${signal}`);
  error.reviewOutcome = "aborted";
  return error;
}

export function remainingRunTime(deadline, now = Date.now()) {
  const remaining = deadline - now;
  if (remaining > 0) return remaining;
  const error = new Error("review run reached limits.maxDurationMinutes");
  error.reviewOutcome = "capped";
  throw error;
}

async function withinRunDeadline(promise, deadline) {
  const remaining = remainingRunTime(deadline);
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          try {
            remainingRunTime(deadline);
          } catch (error) {
            reject(error);
          }
        }, remaining);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runReview({ lens, findingsFile, dryRun = false, forceUnlock = false, ifDue = false } = {}) {
  REVIEW_CONFIG = await loadReviewConfig({ file: CONFIG_FILE, root: REPO_ROOT });
  REVIEW_PATHS = resolveReviewPaths(REVIEW_CONFIG, REPO_ROOT);
  const planArgs = ["start", "--json", "--dry-run"];
  if (lens) planArgs.push("--lens", lens);
  if (ifDue) planArgs.push("--if-due");
  const plan = JSON.parse((await nodeScript(CYCLE_SCRIPT, planArgs)).stdout);
  if (plan.skipped) return { ok: true, skipped: true, reason: plan.reason };
  if (dryRun && plan.mode === "llm" && !findingsFile) {
    return { ok: true, dryRun: true, plan, detected: null, wouldRegister: null, capped: plan.truncated };
  }
  const prepared = plan.mode === "llm" ? await readRunFindings(findingsFile, plan) : null;
  if (dryRun) {
    const rawFindings = prepared ?? await readRunFindings(null, plan);
    const normalized = validateFindingScope(rawFindings.map((entry, index) => normalizeRunFinding(entry, index, plan)), plan);
    return {
      ok: true,
      dryRun: true,
      plan,
      detected: normalized.length,
      wouldRegister: Math.min(normalized.length, plan.maxFindings),
      capped: normalized.length > plan.maxFindings || plan.truncated
    };
  }

  const startArgs = ["start", "--json", "--lens", plan.lens, ...(forceUnlock ? ["--force-unlock"] : [])];
  let interrupted = null;
  const onSigint = () => { interrupted ??= "SIGINT"; };
  const onSigterm = () => { interrupted ??= "SIGTERM"; };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const ensureActive = () => {
    if (interrupted) throw interruptedError(interrupted);
  };
  let runId = null;
  let started = null;
  let deadline = null;
  const registrations = [];
  let closed = false;
  try {
    started = JSON.parse((await nodeScript(CYCLE_SCRIPT, startArgs)).stdout);
    runId = started.runId;
    if (!sameExecutionPlan(plan, started)) fail(`review plan changed before start: ${plan.lens}`);
    deadline = Date.now() + REVIEW_CONFIG.limits.maxDurationMinutes * 60_000;
    const timedNode = async (file, args) => {
      try {
        return await nodeScript(file, args, { timeout: remainingRunTime(deadline) });
      } catch (error) {
        if (Date.now() >= deadline) remainingRunTime(deadline);
        throw error;
      }
    };
    ensureActive();
    const rawFindings = prepared ?? await withinRunDeadline(readRunFindings(null, started), deadline);
    ensureActive();
    const normalized = validateFindingScope(rawFindings.map((entry, index) => normalizeRunFinding(entry, index, started)), started);
    const selected = normalized.slice(0, started.maxFindings);
    const capped = normalized.length > started.maxFindings || started.truncated;
    for (const finding of selected) {
      ensureActive();
      const registered = JSON.parse((await timedNode(BACKLOG_SCRIPT, findingArgs(runId, finding))).stdout);
      registrations.push(registered);
    }
    ensureActive();
    await timedNode(BACKLOG_SCRIPT, ["report"]);
    await timedNode(BACKLOG_SCRIPT, ["validate", "--report"]);
    const runs = validateRunLedger(await readJsonl(REVIEW_PATHS.runs));
    if (!runs.some((entry) => entry.runId === runId && entry.outcome === "running")) fail(`${runId} is not running before finalization`);
    const outcome = capped ? "capped" : registrations.some((entry) => entry.outcome === "added") ? "ok" : "empty";
    const notes = [];
    if (normalized.length > started.maxFindings) notes.push(`検出 ${normalized.length} 件のうち上限 ${started.maxFindings} 件を登録。残りは次サイクルへ送る`);
    if (started.truncated) notes.push(`走査対象 ${started.totalFiles} 件のうち上限 ${started.files.length} 件を走査。残りは次サイクルへ送る`);
    ensureActive();
    await nodeScript(CYCLE_SCRIPT, finishArgs(runId, outcome, registrations, notes));
    closed = true;
    await nodeScript(CYCLE_SCRIPT, ["stats"]);
    validateRunLedger(await readJsonl(REVIEW_PATHS.runs));
    return { ok: true, runId, lens: started.lens, outcome, detected: normalized.length, registrations };
  } catch (error) {
    if (runId && !closed) {
      const note = `review run failed: ${String(error.message ?? error).slice(0, 500)}`;
      try {
        const outcome = error.reviewOutcome ?? (interrupted ? "aborted" : "failed");
        await nodeScript(CYCLE_SCRIPT, finishArgs(runId, outcome, registrations, [note]));
        closed = true;
        await nodeScript(CYCLE_SCRIPT, ["stats"], { allowFailure: true });
        if (outcome === "capped") {
          return { ok: true, runId, lens: started?.lens ?? lens, outcome, detected: null, registrations, timedOut: true };
        }
      } catch (finishError) {
        error.message = `${error.message}; failed to close ${runId}: ${finishError.message}`;
      }
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand) fail("usage: npm run review -- <doctor|run|sync|check|health|autofix> [options]");
  const flags = new Set(["--json", "--dry-run", "--force-unlock", "--if-due"]);
  const valued = new Set(["--lens", "--findings"]);
  const options = { subcommand, json: false, dryRun: false, forceUnlock: false, ifDue: false, lens: null, findingsFile: null };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (flags.has(token)) {
      const key = token.slice(2).replace("dry-run", "dryRun").replace("force-unlock", "forceUnlock").replace("if-due", "ifDue");
      options[key] = true;
      continue;
    }
    if (valued.has(token)) {
      const value = rest[++index];
      if (!value || value.startsWith("--")) fail(`option requires a value: ${token}`);
      options[token === "--lens" ? "lens" : "findingsFile"] = value;
      continue;
    }
    fail(`unknown option: ${token}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const [subcommand, ...adapterArgs] = argv;
  if (subcommand === "check") {
    const { main: checksMain } = await import("./review-checks.mjs");
    await checksMain(adapterArgs);
    return;
  }
  if (subcommand === "health") {
    const { main: backlogMain } = await import("./backlog.mjs");
    const { main: cycleMain } = await import("./review-cycle.mjs");
    if (!adapterArgs.includes("--stdout")) await backlogMain(["report", "--quiet"]);
    await cycleMain(["stats", ...adapterArgs]);
    return;
  }
  if (subcommand === "autofix") {
    const { main: autofixMain } = await import("./review-autofix.mjs");
    await autofixMain(adapterArgs);
    return;
  }
  const options = parseArgs(argv);
  if (options.subcommand === "doctor") {
    if (options.lens || options.findingsFile || options.forceUnlock || options.ifDue) fail("doctor does not accept --lens, --findings, --force-unlock, or --if-due");
    if (options.dryRun) fail("doctor is always read-only; --dry-run is not needed");
    const report = await runDoctor();
    console.log(options.json ? JSON.stringify(report, null, 2) : renderDoctor(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (options.subcommand === "sync") {
    if (options.lens || options.findingsFile || options.forceUnlock || options.ifDue) fail("sync does not accept --lens, --findings, --force-unlock, or --if-due");
    const { main: autofixMain } = await import("./review-autofix.mjs");
    await autofixMain(["sync", ...(options.json ? ["--json"] : []), ...(options.dryRun ? ["--dry-run"] : [])]);
    return;
  }
  if (options.subcommand === "run") {
    const report = await runReview(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : report.skipped
      ? "期限が到来したレンズはない（正常終了）"
      : report.dryRun
      ? report.detected === null
        ? `${report.plan.lens}: LLM点検用の計画を生成（--findings を付けた実行時に登録）`
        : `${report.plan.lens}: 検出 ${report.detected} 件 / 登録予定 ${report.wouldRegister} 件${report.capped ? "（上限到達）" : ""}`
      : `${report.runId} ${report.outcome}: 登録 ${report.registrations.filter((entry) => entry.outcome === "added").length} 件 / 再検出 ${report.registrations.filter((entry) => entry.outcome !== "added").length} 件`);
    return;
  }
  fail(`unknown command: ${options.subcommand}`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`review: ${error.message}`);
    process.exitCode = 1;
  });
}
