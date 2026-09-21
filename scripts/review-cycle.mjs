// 自動レビューサイクルの実行台帳と進行係。
// 設計: docs/dev/automated-review-cycle-design-2026-09-16.md（§2.1 / §2.3 / §2.7 / §2.10）
// 手順: docs/dev/automated-review-cycle-runbook.md
//
// サイクル 1 回は start → （観点に沿って点検し backlog:add）→ finish で閉じる。
// レンズの選択・走査範囲・上限・ロックはここが持ち、各パスと既定上限は review.config.json から読む。
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  CADENCE_DAYS,
  daysBetween,
  dueLenses,
  filterByScope,
  isDue,
  lensStaleness,
  maxFindingsOf,
  readLenses,
  selectLenses,
  serializeLenses,
  LENSES_FILE,
  REPO_ROOT
} from "./review-lenses.mjs";
import { CHECKS, listRepoFiles, runChecks } from "./review-checks.mjs";
import { REVIEW_CONFIG, REVIEW_PATHS } from "./review-config.mjs";

const execFileAsync = promisify(execFile);

const RUNS_FILE = REVIEW_PATHS.runs;
const HEALTH_FILE = REVIEW_PATHS.health;
const FINDINGS_FILE = REVIEW_PATHS.findings;
const FIXES_FILE = REVIEW_PATHS.fixes;
const LOCK_FILE = `${RUNS_FILE}.lock`;

// 1 サイクルの打ち切り条件（設計 §2.10）。超えたら outcome: capped で閉じる。
export const DEFAULT_GATES = {
  maxScannedFiles: REVIEW_CONFIG.limits.maxScannedFiles,
  maxRunMinutes: REVIEW_CONFIG.limits.maxDurationMinutes,
  staleLockMinutes: REVIEW_CONFIG.limits.staleLockMinutes
};

export const RUN_OUTCOMES = ["running", "ok", "empty", "capped", "failed", "aborted"];

function fail(message) {
  throw new Error(message);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

/* ------------------------------------------------------------------ 台帳 */

export function parseRuns(content) {
  const runs = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      runs.push(JSON.parse(line));
    } catch (error) {
      fail(`invalid JSONL at ${REVIEW_CONFIG.paths.runs} line ${index + 1}: ${error.message}`);
    }
  }
  return runs;
}

export function serializeRuns(runs) {
  return runs.map((run) => JSON.stringify(run)).join("\n") + (runs.length ? "\n" : "");
}

async function readRuns() {
  try {
    return parseRuns(await fs.readFile(RUNS_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function nextRunId(runs, date = today()) {
  const prefix = `RUN-${date}-`;
  const used = runs.filter((run) => run.runId?.startsWith(prefix)).length;
  return `${prefix}${String(used + 1).padStart(2, "0")}`;
}

export function lastRunFor(runs, lensId) {
  return [...runs].reverse().find((run) => run.lens === lensId && run.outcome !== "running");
}

export function openRuns(runs) {
  return runs.filter((run) => run.outcome === "running");
}

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// 放置ロックは黙って消さない。保持プロセスと経過時間を出してから判断させる（設計 §2.10）。
export function describeStaleLock(lock, now = Date.now(), gates = DEFAULT_GATES) {
  const ageMinutes = Math.round((now - Date.parse(lock.startedAt)) / 60_000);
  const alive = Number.isInteger(lock.pid) ? isProcessAlive(lock.pid) : false;
  return {
    ageMinutes,
    alive,
    stale: !alive && ageMinutes >= gates.staleLockMinutes,
    message: `lock held by pid ${lock.pid}${alive ? "（実行中）" : "（不在）"} since ${lock.startedAt}（${ageMinutes} 分経過）`
  };
}

async function withLock(callback, { force = false } = {}) {
  await fs.mkdir(path.dirname(RUNS_FILE), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      handle = await fs.open(LOCK_FILE, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "" }));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const raw = await fs.readFile(LOCK_FILE, "utf8").catch(() => "{}");
      const lock = JSON.parse(raw || "{}");
      const status = describeStaleLock(lock);
      if (force || status.stale) {
        console.warn(`review-cycle: removing lock — ${status.message}`);
        await fs.rm(LOCK_FILE, { force: true });
        continue;
      }
      if (attempt === 49) fail(`${status.message}. 実行中でなければ --force-unlock を付ける`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(LOCK_FILE, { force: true });
  }
}

/* -------------------------------------------------------------------- git */

async function git(args) {
  try {
    const { stdout } = await execFileAsync("git", ["-c", `safe.directory=${REPO_ROOT.replaceAll("\\", "/")}`, ...args], { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch {
    return null;
  }
}

async function gitRequired(args) {
  const output = await git(args);
  if (output === null) fail(`git ${args.join(" ")} を実行できないため、差分監査を続行しない`);
  return output;
}

async function headCommit() {
  return gitRequired(["rev-parse", "--short", "HEAD"]);
}

// base が無い（そのレンズの初回）ときは null を返し、呼び出し側が全量走査へ倒す。
export async function changedFiles(base) {
  if (!base) return null;
  const diff = await gitRequired(["diff", "--name-only", `${base}..HEAD`]);
  const status = await gitRequired(["status", "--porcelain"]);
  const pending = status.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
  return [...new Set([...diff.split("\n"), ...pending])].filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}

/* ------------------------------------------------------------------ plan */

export function buildPlan(lens, files, { base, head, gates = DEFAULT_GATES }) {
  const capped = files.length > gates.maxScannedFiles;
  return {
    lens: lens.id,
    title: lens.title,
    mode: lens.mode,
    category: lens.category,
    app: lens.app ?? null,
    area: lens.area ?? null,
    cadence: lens.cadence,
    prompt: lens.prompt ?? null,
    check: lens.check ?? null,
    maxFindings: maxFindingsOf(lens),
    base: base ?? null,
    head: head ?? null,
    scanMode: base ? "diff" : "full",
    files: capped ? files.slice(0, gates.maxScannedFiles) : files,
    truncated: capped,
    totalFiles: files.length
  };
}

async function planFor(lens, runs, gates) {
  const previous = lastRunFor(runs, lens.id);
  const base = previous?.headCommit ?? null;
  const head = await headCommit();
  const allFiles = await listRepoFiles();
  const changed = await changedFiles(base);
  const candidates = changed ? allFiles.filter((file) => changed.includes(file)) : allFiles;
  return buildPlan(lens, filterByScope(candidates, lens), { base, head, gates });
}

function renderPlan(plan) {
  const lines = [
    `# ${plan.lens} — ${plan.title}`,
    "",
    `- モード: ${plan.mode}${plan.check ? `（check: ${plan.check}）` : ""}`,
    `- 既定の分類: category=${plan.category} app=${plan.app ?? "（観点に応じて選ぶ）"} area=${plan.area ?? "（観点に応じて選ぶ）"}`,
    `- 走査範囲: ${plan.scanMode === "diff" ? `${plan.base}..${plan.head} の変更分` : "全量（このレンズの初回）"} / ${plan.totalFiles} ファイル${plan.truncated ? `（先頭 ${plan.files.length} 件に打ち切り）` : ""}`,
    `- 登録上限: ${plan.maxFindings} 件`,
    ""
  ];
  if (plan.prompt) lines.push("## 観点", "", plan.prompt, "");
  lines.push("## 対象ファイル", "", plan.files.length ? plan.files.map((file) => `- ${file}`).join("\n") : "（変更なし。outcome=empty で閉じる）", "");
  return lines.join("\n");
}

/* ----------------------------------------------------------------- stats */

export function medianDays(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function isSuppressedRecord(record, on) {
  if (["verified", "monitoring", "wont-fix"].includes(record.status)) return true;
  return Boolean(record.suppress?.until && record.suppress.until >= on);
}

function needsManual(record) {
  if (!["manual", "both"].includes(record.verificationRequired)) return false;
  if (record.status === "monitoring") return false;
  return !(record.verification ?? []).some((entry) => entry.method === "manual" && entry.result === "passed");
}

// 無人運転で「失敗に気づかない」を防ぐための通知条件（設計 §2.9）。
// 通知の経路は持たない。review:stats --fail-on-alert の終了コードを CI が拾い、GitHub の失敗通知に乗せる。
export const ALERT_WINDOW_DAYS = 7;
const FAILED_RUN_OUTCOMES = ["failed", "aborted"];
const STOPPED_FIX_OUTCOMES = ["gate-failed", "blocked", "closed"];

export function buildAlerts(records, runs, lenses, fixes, on = today()) {
  const alerts = [];
  const recent = (iso) => Boolean(iso) && daysBetween(iso.slice(0, 10), on) <= ALERT_WINDOW_DAYS;
  const recentlyAdded = new Set(runs.filter((run) => recent(run.finishedAt ?? run.startedAt)).flatMap((run) => run.added ?? []));
  for (const record of records) {
    if (record.priority === "P1" && recentlyAdded.has(record.id) && !isSuppressedRecord(record, on)) {
      alerts.push({ kind: "new-p1", subject: record.id, message: `自動サイクルが P1 を新規登録した: ${record.title}` });
    }
  }
  for (const lens of lenses) {
    const closed = runs.filter((run) => run.lens === lens.id && run.outcome !== "running");
    const lastThree = closed.slice(-3);
    if (lastThree.length === 3 && lastThree.every((run) => FAILED_RUN_OUTCOMES.includes(run.outcome))) {
      alerts.push({ kind: "lens-failing", subject: lens.id, message: `3 サイクル連続で完了していない（${lastThree.map((run) => run.runId).join(", ")}）` });
    }
  }
  const latestFix = new Map();
  for (const fix of fixes) latestFix.set(fix.branch, fix);
  for (const fix of latestFix.values()) {
    if (STOPPED_FIX_OUTCOMES.includes(fix.outcome) && recent(fix.closedAt ?? fix.finishedAt ?? fix.gate?.at ?? fix.startedAt)) {
      alerts.push({ kind: "autofix-stopped", subject: fix.finding, message: `自動修正が止まった（${fix.fixId} / ${fix.outcome}）: ${fix.branch}` });
    }
  }
  return alerts;
}

export function buildHealth(records, runs, lenses, on = today(), { fixes = [] } = {}) {
  const open = records.filter((record) => !isSuppressedRecord(record, on));
  const ageOf = (record) => daysBetween(record.updatedAt, on);
  const stalePriority1 = open.filter((record) => record.priority === "P1" && ageOf(record) >= 30);
  const lensRows = lenses.map((lens) => {
    const lensRuns = runs.filter((run) => run.lens === lens.id && run.outcome !== "running");
    const added = lensRuns.reduce((sum, run) => sum + (run.added?.length ?? 0), 0);
    return {
      id: lens.id,
      title: lens.title,
      cadence: lens.cadence,
      enabled: lens.enabled,
      lastRunAt: lens.lastRunAt,
      staleness: lens.lastRunAt ? lensStaleness(lens, on) : null,
      due: isDue(lens, on),
      runs: lensRuns.length,
      added,
      idle: lensRuns.length >= 3 && added === 0
    };
  });
  return {
    generatedAt: on,
    total: records.length,
    open: open.length,
    byStatus: Object.fromEntries(["discovered", "triaged", "in-progress", "monitoring", "verified", "wont-fix"].map((status) => [status, records.filter((record) => record.status === status).length])),
    byPriority: Object.fromEntries(["P1", "P2", "P3"].map((priority) => [priority, open.filter((record) => record.priority === priority).length])),
    medianOpenAgeDays: medianDays(open.map(ageOf)),
    stalePriority1: stalePriority1.map((record) => ({ id: record.id, title: record.title, days: ageOf(record) })),
    manualDebt: open.filter(needsManual).map((record) => ({ id: record.id, title: record.title })),
    lenses: lensRows,
    recentRuns: runs.slice(-10).reverse(),
    fixes: {
      total: fixes.length,
      byOutcome: fixes.reduce((counts, fix) => ({ ...counts, [fix.outcome]: (counts[fix.outcome] ?? 0) + 1 }), {}),
      recent: fixes.slice(-10).reverse()
    },
    alerts: buildAlerts(records, runs, lenses, fixes, on)
  };
}

function healthTable(header, rows) {
  if (!rows.length) return "該当なし";
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

export function renderHealth(health) {
  const lines = [
    "# バックログ健全性",
    "",
    "> `npm run review -- health` が生成。直接編集しない。",
    "",
    `生成日: ${health.generatedAt}`,
    "",
    "## 通知",
    "",
    healthTable(["種別", "対象", "内容"], (health.alerts ?? []).map((alert) => [alert.kind, alert.subject, alert.message])),
    "",
    "## 件数",
    "",
    `- 総数 ${health.total} / 未了 ${health.open}（抑止中・実質終了を除く）`,
    `- 優先度（未了）: P1 ${health.byPriority.P1} / P2 ${health.byPriority.P2} / P3 ${health.byPriority.P3}`,
    `- 状態: ${Object.entries(health.byStatus).map(([status, count]) => `${status} ${count}`).join(" / ")}`,
    `- 未了項目の滞留（updatedAt からの中央値）: ${health.medianOpenAgeDays === null ? "該当なし" : `${health.medianOpenAgeDays} 日`}`,
    "",
    "## 30 日以上動いていない P1",
    "",
    healthTable(["ID", "滞留日数", "タイトル"], health.stalePriority1.map((record) => [record.id, String(record.days), record.title])),
    "",
    "## 実画面確認の借金（manual 未検証）",
    "",
    healthTable(["ID", "タイトル"], health.manualDebt.map((record) => [record.id, record.title])),
    "",
    "## レンズ",
    "",
    healthTable(["ID", "周期", "最終実行", "経過", "期限", "実行回数", "登録数", "備考"], health.lenses.map((lens) => [
      lens.id,
      lens.cadence,
      lens.lastRunAt ?? "未実行",
      lens.staleness === null ? "—" : `${lens.staleness} 日`,
      lens.enabled ? (lens.due ? "到来" : "—") : "無効",
      String(lens.runs),
      String(lens.added),
      lens.idle ? "3 回以上回して検出 0。観点の見直しを検討" : ""
    ])),
    "",
    "## 直近のサイクル",
    "",
    healthTable(["runId", "レンズ", "開始", "結果", "走査", "登録", "再検出"], health.recentRuns.map((run) => [
      run.runId,
      run.lens,
      (run.startedAt ?? "").slice(0, 16).replace("T", " "),
      run.outcome,
      String(run.scannedFiles ?? 0),
      (run.added ?? []).join(" ") || "—",
      (run.suppressed ?? []).join(" ") || "—"
    ])),
    "",
    "## 自動修正",
    "",
    `- 総数 ${health.fixes?.total ?? 0}${Object.keys(health.fixes?.byOutcome ?? {}).length ? `（${Object.entries(health.fixes.byOutcome).map(([outcome, count]) => `${outcome} ${count}`).join(" / ")}）` : ""}`,
    "",
    healthTable(["fixId", "発見事項", "区分", "結果", "ゲート", "ブランチ"], (health.fixes?.recent ?? []).map((fix) => [
      fix.fixId,
      fix.finding,
      fix.fixClass,
      fix.outcome,
      fix.gate ? `${fix.gate.ok ? "通過" : "不通過"} ${fix.gate.files} ファイル / ${fix.gate.lines} 行` : "—",
      fix.branch
    ])),
    ""
  ];
  return lines.join("\n");
}

async function readFixRecords() {
  try {
    const content = await fs.readFile(FIXES_FILE, "utf8");
    return content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readFindingRecords() {
  try {
    const content = await fs.readFile(FINDINGS_FILE, "utf8");
    return content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/* ------------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) fail("usage: node scripts/review-cycle.mjs <lenses|plan|start|finish|runs|stats|check>");
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    const name = equals >= 0 ? raw.slice(0, equals) : raw;
    const inline = equals >= 0 ? raw.slice(equals + 1) : undefined;
    const value = inline ?? (rest[index + 1]?.startsWith("--") ? true : rest[++index] ?? true);
    options.set(name, [...(options.get(name) ?? []), value]);
  }
  return { command, positionals, options };
}

const one = (options, name, fallback) => {
  const value = options.get(name)?.at(-1);
  return value === undefined || value === true ? fallback : value;
};
const many = (options, name) => (options.get(name) ?? []).filter((value) => value !== true);
const has = (options, name) => options.has(name);

async function commandLenses(options) {
  const lenses = await readLenses();
  const on = today();
  const rows = has(options, "due") ? dueLenses(lenses, on) : lenses;
  if (has(options, "json")) {
    console.log(JSON.stringify(rows.map((lens) => ({ ...lens, due: isDue(lens, on), staleness: lens.lastRunAt ? lensStaleness(lens, on) : null })), null, 2));
    return;
  }
  for (const lens of rows) {
    const state = !lens.enabled ? "無効" : isDue(lens, on) ? "到来" : `残 ${CADENCE_DAYS[lens.cadence] - lensStaleness(lens, on)} 日`;
    console.log(`${lens.id}\t${lens.mode}\t${lens.cadence}\t${lens.lastRunAt ?? "未実行"}\t${state}\t${lens.title}`);
  }
}

async function commandPlan(options) {
  const lenses = await readLenses();
  const runs = await readRuns();
  const selected = selectLenses(lenses, today(), {
    limit: Number(one(options, "limit", 1)),
    mode: one(options, "mode", undefined),
    id: one(options, "lens", undefined)
  });
  if (!selected.length) {
    console.log("期限が到来したレンズはない");
    return;
  }
  const plans = [];
  for (const lens of selected) plans.push(await planFor(lens, runs, DEFAULT_GATES));
  if (has(options, "json")) {
    console.log(JSON.stringify(plans, null, 2));
    return;
  }
  console.log(plans.map(renderPlan).join("\n---\n\n"));
}

async function commandStart(options) {
  const lenses = await readLenses();
  const runs = await readRuns();
  const [lens] = selectLenses(lenses, today(), { limit: 1, mode: one(options, "mode", undefined), id: one(options, "lens", undefined) });
  if (!lens && has(options, "if-due")) {
    const result = { skipped: true, reason: "not-due", plan: null };
    console.log(has(options, "json") ? JSON.stringify(result, null, 2) : "期限が到来したレンズはない（正常終了）");
    return;
  }
  if (!lens) fail("期限が到来したレンズはない。--lens で明示するか cadence を見直す");
  const plan = await planFor(lens, runs, DEFAULT_GATES);
  if (has(options, "dry-run")) {
    console.log(has(options, "json") ? JSON.stringify({ ...plan, runId: null, dryRun: true }, null, 2) : renderPlan(plan));
    return;
  }
  await withLock(async () => {
    const current = await readRuns();
    const stillOpen = openRuns(current);
    if (stillOpen.length && !has(options, "force")) {
      fail(`未完了のサイクルがある: ${stillOpen.map((run) => `${run.runId}(${run.lens})`).join(", ")}。finish で閉じるか --force を付ける`);
    }
    const run = {
      runId: nextRunId(current),
      lens: lens.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      baseCommit: plan.base,
      headCommit: plan.head,
      scanMode: plan.scanMode,
      scannedFiles: plan.totalFiles,
      maxFindings: plan.maxFindings,
      added: [],
      updated: [],
      suppressed: [],
      outcome: "running",
      notes: []
    };
    await atomicWrite(RUNS_FILE, serializeRuns([...current, run]));
    console.log(has(options, "json") ? JSON.stringify({ ...plan, runId: run.runId }, null, 2) : `${run.runId} started\n\n${renderPlan(plan)}`);
  }, { force: has(options, "force-unlock") });
}

async function commandFinish(positionals, options) {
  const runId = positionals[0];
  if (!runId) fail(`usage: npm run review:finish -- RUN-2026-09-16-01 --outcome ok [--added ${REVIEW_CONFIG.vocabulary.findingIdPrefix}-033]`);
  const added = many(options, "added");
  const requested = one(options, "outcome", added.length ? "ok" : "empty");
  if (!RUN_OUTCOMES.includes(requested)) fail(`invalid outcome: ${requested}`);
  await withLock(async () => {
    const runs = await readRuns();
    const originalRuns = serializeRuns(runs);
    const run = runs.find((entry) => entry.runId === runId);
    if (!run) fail(`unknown run: ${runId}`);
    if (run.outcome !== "running") fail(`${runId} is already closed: ${run.outcome}`);
    run.added = [...new Set([...run.added, ...added])];
    run.updated = [...new Set([...run.updated, ...many(options, "updated")])];
    run.suppressed = [...new Set([...run.suppressed, ...many(options, "suppressed")])];
    for (const note of many(options, "note")) run.notes.push(nonEmptyString(note, "note"));
    // 上限超過は失敗ではなく打ち切り。次サイクルへ送る（設計 §2.10）。
    const overCap = run.added.length > (run.maxFindings ?? Number.POSITIVE_INFINITY);
    run.outcome = overCap && requested === "ok" ? "capped" : requested;
    run.finishedAt = new Date().toISOString();
    let originalLenses = null;
    try {
      await atomicWrite(RUNS_FILE, serializeRuns(runs));
      if (["ok", "empty", "capped"].includes(run.outcome)) {
        const lenses = await readLenses();
        originalLenses = serializeLenses(lenses);
        const lens = lenses.find((entry) => entry.id === run.lens);
        if (lens) {
          lens.lastRunAt = today();
          await atomicWrite(LENSES_FILE, serializeLenses(lenses));
        }
      }
    } catch (error) {
      const rollbackErrors = [];
      await atomicWrite(RUNS_FILE, originalRuns).catch((rollback) => rollbackErrors.push(`runs: ${rollback.message}`));
      if (originalLenses !== null) {
        await atomicWrite(LENSES_FILE, originalLenses).catch((rollback) => rollbackErrors.push(`lenses: ${rollback.message}`));
      }
      const suffix = rollbackErrors.length ? `; rollback failed (${rollbackErrors.join(", ")})` : "";
      throw new Error(`failed to finalize ${runId}; restored the previous ledgers${suffix}`, { cause: error });
    }
    console.log(`${runId} ${run.outcome}${overCap ? `（上限 ${run.maxFindings} 件を超過）` : ""}: added ${run.added.length} / suppressed ${run.suppressed.length}`);
  }, { force: has(options, "force-unlock") });
}

async function commandRuns(options) {
  const runs = await readRuns();
  const limit = Number(one(options, "limit", 10));
  const rows = runs.slice(-limit).reverse();
  if (has(options, "json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("実行記録なし");
    return;
  }
  for (const run of rows) console.log(`${run.runId}\t${run.lens}\t${run.outcome}\t走査 ${run.scannedFiles}\t登録 ${(run.added ?? []).join(",") || "—"}\t再検出 ${(run.suppressed ?? []).join(",") || "—"}`);
}

async function commandStats(options) {
  const health = buildHealth(await readFindingRecords(), await readRuns(), await readLenses(), today(), { fixes: await readFixRecords() });
  if (has(options, "fail-on-alert") && health.alerts.length) {
    for (const alert of health.alerts) console.error(`[ALERT] ${alert.kind} ${alert.subject} — ${alert.message}`);
    process.exitCode = 1;
  }
  if (has(options, "json")) {
    console.log(JSON.stringify(health, null, 2));
    return;
  }
  const content = renderHealth(health);
  if (has(options, "stdout")) {
    console.log(content);
    return;
  }
  await atomicWrite(HEALTH_FILE, content);
  console.log(`health written: ${path.relative(REPO_ROOT, HEALTH_FILE)}`);
}

// deterministic レンズを台帳ごと回す。check 単体で叩きたいときは review-checks.mjs を直接使う。
async function commandCheck(options) {
  const lenses = await readLenses();
  const targets = (one(options, "lens", undefined)
    ? selectLenses(lenses, today(), { id: one(options, "lens") })
    : lenses.filter((lens) => lens.mode === "deterministic" && lens.enabled));
  const ids = targets.map((lens) => lens.check).filter(Boolean);
  const unknown = ids.filter((id) => !CHECKS.some((check) => check.id === id));
  if (unknown.length) fail(`lens references unknown check: ${unknown.join(", ")}`);
  const results = await runChecks(ids);
  if (has(options, "json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      if (!result.issues.length) {
        console.log(`[OK] ${result.check} — 問題なし（${result.scanned} ファイル）`);
        continue;
      }
      for (const issue of result.issues) console.log(`[WARN] ${issue.file}${issue.line ? `:${issue.line}` : ""} — ${issue.message}\n  推奨対処: ${issue.hint}`);
      console.log(`[SUM] ${result.check} — ${result.issues.length} 件（${result.scanned} ファイル）`);
    }
  }
  const total = results.reduce((sum, result) => sum + result.issues.length, 0);
  if (total > 0 && has(options, "strict")) process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, positionals, options } = parseArgs(argv);
  switch (command) {
    case "lenses": await commandLenses(options); break;
    case "plan": await commandPlan(options); break;
    case "start": await commandStart(options); break;
    case "finish": await commandFinish(positionals, options); break;
    case "runs": await commandRuns(options); break;
    case "stats": await commandStats(options); break;
    case "check": await commandCheck(options); break;
    default: fail(`unknown command: ${command}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`review-cycle: ${error.message}`);
    process.exitCode = 1;
  });
}
