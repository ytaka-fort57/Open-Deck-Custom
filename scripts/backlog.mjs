// 残課題バックログ CLI。
// 正本は docs/backlog/findings.jsonl、人が読む一覧は docs/backlog/report.md。
// どちらもこのスクリプト経由でのみ更新する（直接編集しない）。
// 由来: ai_usage_dashboard の scripts/ux-backlog.mjs を本リポジトリ向けに移植
// （置き場所を docs/backlog/ へ、ID を BL-、app 軸を本リポジトリの構成要素へ変更）。
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BACKLOG_DIR = path.join(REPO_ROOT, "docs", "backlog");
const FINDINGS_FILE = path.join(BACKLOG_DIR, "findings.jsonl");
const REPORT_FILE = path.join(BACKLOG_DIR, "report.md");
const LOCK_FILE = path.join(BACKLOG_DIR, "findings.jsonl.lock");

export const STATUS_VALUES = ["discovered", "triaged", "in-progress", "monitoring", "verified", "wont-fix"];
export const CATEGORY_VALUES = ["uiux", "architecture", "persistence", "release", "validation", "security", "performance", "feature", "i18n"];
export const PRIORITY_VALUES = ["P1", "P2", "P3"];
export const VERIFICATION_REQUIRED_VALUES = ["code", "manual", "both"];
export const VERIFICATION_METHOD_VALUES = ["code", "manual"];
export const VERIFICATION_RESULT_VALUES = ["passed", "failed", "not-checked"];

// 対象の構成要素。content = 本家 content.js、custom = extensions/custom/、
// helper = 本家の extensions/*.js とiframe注入helper、background = background.js、
// tests = tests/、docs = docs/、config = manifest / package / verify / CI。
export const APP_VALUES = ["content", "custom", "helper", "background", "tests", "docs", "config"];

export const AREA_VALUES = [
  "interaction",
  "state",
  "responsive",
  "accessibility",
  "visual",
  "copy",
  "navigation",
  "layout",
  "feedback",
  "performance",
  "architecture",
  "persistence",
  "migration",
  "release",
  "validation",
  "security",
  "i18n",
  "lifecycle",
  "history",
  "css"
];

const STATUS_TRANSITIONS = {
  discovered: new Set(["discovered", "triaged", "in-progress", "wont-fix"]),
  triaged: new Set(["triaged", "in-progress", "wont-fix"]),
  "in-progress": new Set(["in-progress", "monitoring", "verified", "wont-fix"]),
  monitoring: new Set(["monitoring", "in-progress", "verified", "wont-fix"]),
  verified: new Set(["verified", "in-progress"]),
  "wont-fix": new Set(["wont-fix", "triaged"])
};

export function canTransition(from, to) {
  return STATUS_TRANSITIONS[from]?.has(to) ?? false;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) fail("usage: node scripts/backlog.mjs <add|list|show|update|verify|suppress|report|validate>");

  const positionals = [];
  const parsed = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const rawName = token.slice(2);
    const equalsIndex = rawName.indexOf("=");
    const name = equalsIndex >= 0 ? rawName.slice(0, equalsIndex) : rawName;
    const inlineValue = equalsIndex >= 0 ? rawName.slice(equalsIndex + 1) : undefined;
    const value = inlineValue ?? (rest[index + 1]?.startsWith("--") ? true : rest[++index]);
    const values = parsed.get(name) ?? [];
    values.push(value);
    parsed.set(name, values);
  }
  return { command, positionals, options: parsed };
}

function option(optionsMap, name, { required = false, defaultValue = undefined } = {}) {
  const values = optionsMap.get(name);
  if (!values || values.length === 0) {
    if (required) fail(`missing required option: --${name}`);
    return defaultValue;
  }
  const value = values.at(-1);
  if (value === true) fail(`option requires a value: --${name}`);
  return value;
}

function optionList(optionsMap, name) {
  return (optionsMap.get(name) ?? []).filter((value) => value !== true);
}

function hasOption(optionsMap, name) {
  return optionsMap.has(name);
}

async function ensureBacklogDir() {
  await fs.mkdir(BACKLOG_DIR, { recursive: true });
}

async function readFindings() {
  try {
    const content = await fs.readFile(FINDINGS_FILE, "utf8");
    const records = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        fail(`invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    }
    return records;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeRepoPath(value) {
  // findings.jsonl は Windows / Linux 双方で読むため、絶対パス判定を実行 OS に委ねない。
  // path.isAbsolute("C:/x") は Windows でだけ true になり、Linux の CI をすり抜ける。
  if (!value || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    fail(`evidence path must be repository-relative: ${value}`);
  }
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.includes("..") || segments.includes(".")) {
    fail(`evidence path must not contain . or ..: ${value}`);
  }
  return normalized;
}

function parseLineRange(value) {
  if (!value) return undefined;
  if (!/^\d+(?:-\d+)?$/.test(value)) fail(`invalid line range: ${value}`);
  const [start, end = start] = value.split("-").map(Number);
  if (start < 1 || end < start) fail(`invalid line range: ${value}`);
  return `${start}-${end}`;
}

function parseEvidence(value) {
  const match = value.match(/^(.+?)(?::(\d+(?:-\d+)?))?$/);
  if (!match) fail(`invalid evidence: ${value}`);
  const evidence = { type: "code", file: normalizeRepoPath(match[1]) };
  const lines = parseLineRange(match[2]);
  if (lines) evidence.lines = lines;
  return evidence;
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function parseSourceDocument(value) {
  const raw = nonEmptyString(value, "source-document");
  const separator = raw.indexOf("#");
  const file = separator >= 0 ? raw.slice(0, separator) : raw;
  const section = separator >= 0 ? raw.slice(separator + 1).trim() : "";
  const source = { file: normalizeRepoPath(file) };
  if (section) source.section = section;
  return source;
}

function validateSourceDocument(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) fail(`${field} must be an object`);
  normalizeRepoPath(nonEmptyString(source.file, `${field}.file`));
  if (source.section !== undefined) nonEmptyString(source.section, `${field}.section`);
}

function stringArray(values, field) {
  return values.map((value) => nonEmptyString(value, field));
}

function validateVerificationEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`verification[${index}] must be an object`);
  if (!VERIFICATION_METHOD_VALUES.includes(entry.method)) fail(`verification[${index}].method is invalid`);
  if (!VERIFICATION_RESULT_VALUES.includes(entry.result)) fail(`verification[${index}].result is invalid`);
  if (typeof entry.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.checkedAt)) {
    fail(`verification[${index}].checkedAt must be an ISO date`);
  }
  if (entry.notes !== undefined && typeof entry.notes !== "string") fail(`verification[${index}].notes must be a string`);
  if (entry.method === "manual") {
    for (const field of ["screen", "viewport", "observed"]) nonEmptyString(entry[field], `verification[${index}].${field}`);
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) fail(`verification[${index}].steps must not be empty`);
    stringArray(entry.steps, `verification[${index}].steps`);
  }
}

function validateEvidenceEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`evidence[${index}] must be an object`);
  if (!["code", "manual", "reproduction"].includes(entry.type)) fail(`evidence[${index}].type is invalid`);
  if (entry.type === "code") {
    nonEmptyString(entry.file, `evidence[${index}].file`);
    normalizeRepoPath(entry.file);
    if (entry.lines !== undefined) parseLineRange(entry.lines);
    if (entry.commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(entry.commit)) fail(`evidence[${index}].commit is invalid`);
  }
  if (entry.type === "manual") {
    for (const field of ["screen", "viewport", "observed"]) nonEmptyString(entry[field], `evidence[${index}].${field}`);
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) fail(`evidence[${index}].steps must not be empty`);
    stringArray(entry.steps, `evidence[${index}].steps`);
    if (entry.screenshot !== undefined) normalizeRepoPath(entry.screenshot);
  }
  if (entry.type === "reproduction") {
    if (!Array.isArray(entry.steps) || entry.steps.length === 0) fail(`evidence[${index}].steps must not be empty`);
    stringArray(entry.steps, `evidence[${index}].steps`);
  }
}

function hasPassedMethod(record, method) {
  return record.verification.some((entry) => entry.method === method && entry.result === "passed");
}

export function isUnverified(record) {
  if (record.status === "monitoring") return false;
  if (record.verificationRequired === "both") return !hasPassedMethod(record, "code") || !hasPassedMethod(record, "manual");
  return !hasPassedMethod(record, record.verificationRequired);
}

function validateRecord(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail(`record ${index + 1} must be an object`);
  const required = ["id", "createdAt", "updatedAt", "category", "app", "area", "priority", "status", "title", "finding", "impact", "evidence", "proposal", "verificationRequired", "verification"];
  for (const field of required) if (record[field] === undefined) fail(`record ${record.id ?? index + 1} is missing ${field}`);
  if (!/^BL-\d{3,}$/.test(record.id)) fail(`record ${record.id} has an invalid id`);
  for (const field of ["createdAt", "updatedAt"]) if (typeof record[field] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record[field])) fail(`${record.id}.${field} must be an ISO date`);
  if (!APP_VALUES.includes(record.app)) fail(`${record.id}.app is not a known app: ${record.app}`);
  if (record.category !== undefined && !CATEGORY_VALUES.includes(record.category)) fail(`${record.id}.category is invalid: ${record.category}`);
  if (!AREA_VALUES.includes(record.area)) fail(`${record.id}.area is invalid: ${record.area}`);
  if (!PRIORITY_VALUES.includes(record.priority)) fail(`${record.id}.priority is invalid: ${record.priority}`);
  if (!STATUS_VALUES.includes(record.status)) fail(`${record.id}.status is invalid: ${record.status}`);
  if (!VERIFICATION_REQUIRED_VALUES.includes(record.verificationRequired)) fail(`${record.id}.verificationRequired is invalid`);
  for (const field of ["title", "finding", "impact"]) nonEmptyString(record[field], `${record.id}.${field}`);
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) fail(`${record.id}.evidence must not be empty`);
  record.evidence.forEach(validateEvidenceEntry);
  if (record.sourceDocument !== undefined) validateSourceDocument(record.sourceDocument, `${record.id}.sourceDocument`);
  if (!(typeof record.proposal === "string" || (Array.isArray(record.proposal) && record.proposal.length > 0))) fail(`${record.id}.proposal must not be empty`);
  if (record.acceptanceCriteria !== undefined && (!Array.isArray(record.acceptanceCriteria) || record.acceptanceCriteria.some((value) => typeof value !== "string" || !value.trim()))) fail(`${record.id}.acceptanceCriteria is invalid`);
  if (record.status !== "discovered" && (!Array.isArray(record.acceptanceCriteria) || record.acceptanceCriteria.length === 0)) fail(`${record.id} needs acceptanceCriteria from triaged onward`);
  if (!Array.isArray(record.verification)) fail(`${record.id}.verification must be an array`);
  record.verification.forEach(validateVerificationEntry);
  if (record.workNotes !== undefined && (!Array.isArray(record.workNotes) || record.workNotes.some((entry) => !entry || typeof entry.note !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)))) fail(`${record.id}.workNotes is invalid`);
  if (record.relatedCommits !== undefined && (!Array.isArray(record.relatedCommits) || record.relatedCommits.some((commit) => !/^[0-9a-f]{7,40}$/i.test(commit)))) fail(`${record.id}.relatedCommits is invalid`);
  if (record.tags !== undefined && (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) fail(`${record.id}.tags is invalid`);
  if (["in-progress", "monitoring"].includes(record.status) && (!record.relatedCommits?.length && !record.workNotes?.length)) fail(`${record.id} ${record.status} needs workNotes or relatedCommits`);
  if (record.status === "verified" && isUnverified(record)) fail(`${record.id} cannot be verified before required verification passes`);
  if (record.suppress !== undefined && record.suppress !== null) {
    if (typeof record.suppress !== "object" || Array.isArray(record.suppress)) fail(`${record.id}.suppress must be an object`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.suppress.until ?? "")) fail(`${record.id}.suppress.until must be an ISO date`);
    nonEmptyString(record.suppress.reason, `${record.id}.suppress.reason`);
  }
  if (record.status === "wont-fix" && (!record.decision || typeof record.decision.reason !== "string" || !record.decision.reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(record.decision.decidedAt))) fail(`${record.id} wont-fix needs decision.reason and decision.decidedAt`);
}

export function validateRecords(records) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    if (ids.has(records[index].id)) fail(`duplicate id: ${records[index].id}`);
    ids.add(records[index].id);
    validateRecord(records[index], index);
  }
  return records;
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

async function withLock(callback) {
  await ensureBacklogDir();
  let handle;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await fs.open(LOCK_FILE, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!handle) fail(`could not acquire lock: ${LOCK_FILE}`);
  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(LOCK_FILE, { force: true });
  }
}

function formatId(number) {
  return `BL-${String(number).padStart(3, "0")}`;
}

function nextId(records) {
  const max = records.reduce((current, record) => {
    const value = Number(record.id?.slice(3));
    return Number.isInteger(value) ? Math.max(current, value) : current;
  }, 0);
  return formatId(max + 1);
}

function normalizeTitle(value) {
  return value.toLocaleLowerCase("ja-JP").replace(/[\s、。,.!?！？「」『』]/g, "");
}

// 再検出の同一性判定（設計 §2.4）。行番号は含めない。含めるとコミットのたびに別物になり、
// 自動サイクルが 2 巡目から同じ指摘を作り直す。
export function computeFingerprint(record) {
  const files = [...new Set(record.evidence.filter((entry) => entry.type === "code").map((entry) => entry.file))].sort();
  const base = [record.category ?? "architecture", record.app, normalizeTitle(record.title), files.join(",")].join("|");
  return createHash("sha1").update(base).digest("hex").slice(0, 12);
}

// 再検出しても登録し直さない状態。実質終了しているか、明示的に抑止されているもの。
export const SUPPRESSED_STATUSES = ["verified", "monitoring", "wont-fix"];

export function isSuppressed(record, on = today()) {
  if (SUPPRESSED_STATUSES.includes(record.status)) return true;
  if (!record.suppress?.until) return false;
  return record.suppress.until >= on;
}

export function findByFingerprint(records, fingerprint) {
  return records.find((record) => computeFingerprint(record) === fingerprint);
}

function duplicateCandidates(records, record) {
  const title = normalizeTitle(record.title);
  const files = new Set(record.evidence.filter((entry) => entry.type === "code").map((entry) => entry.file));
  return records.filter((existing) => {
    if (existing.app !== record.app) return false;
    if (normalizeTitle(existing.title) === title) return true;
    return existing.evidence.some((entry) => entry.type === "code" && files.has(entry.file));
  });
}

function toJsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
}

function markdownEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("`", "\\`");
}

function priorityValue(priority) {
  return Number(priority.slice(1));
}

function compareRecords(left, right) {
  return priorityValue(left.priority) - priorityValue(right.priority) || left.id.localeCompare(right.id);
}

function codeEvidenceLink(entry) {
  const file = normalizeRepoPath(entry.file);
  const lines = entry.lines ? `:${entry.lines}` : "";
  const firstLine = entry.lines?.split("-")[0];
  const anchor = firstLine ? `#L${firstLine}` : "";
  return `[${markdownEscape(`${file}${lines}`)}](../../${encodeURI(file)}${anchor})`;
}

function renderEvidence(record) {
  return record.evidence.map((entry) => {
    if (entry.type === "code") return `code: ${codeEvidenceLink(entry)}${entry.symbol ? ` (${markdownEscape(entry.symbol)})` : ""}`;
    if (entry.type === "manual") return `manual: ${markdownEscape(entry.screen)} / ${markdownEscape(entry.viewport)} / ${markdownEscape(entry.result ?? "not-checked")}`;
    return `reproduction: ${markdownEscape(entry.steps.join(" → "))}`;
  }).join("<br>");
}

function renderVerification(record) {
  if (!record.verification.length) return "未確認";
  return record.verification.map((entry) => `${entry.method}: ${entry.result}${entry.checkedAt ? ` (${entry.checkedAt})` : ""}${entry.notes ? ` - ${markdownEscape(entry.notes)}` : ""}`).join("<br>");
}

function renderTable(records) {
  if (!records.length) return "該当なし";
  const lines = [
    "| ID | カテゴリ | 対象 | 優先度 | 状態 | タイトル | 影響 | 根拠 | 元文書 | 提案 | 検証 |",
    "|---|---|---|---|---|---|---|---|---|---|---|"
  ];
  for (const record of records) {
    const proposal = Array.isArray(record.proposal) ? record.proposal.join(" / ") : record.proposal;
    const source = record.sourceDocument
      ? `${markdownEscape(record.sourceDocument.file)}${record.sourceDocument.section ? `#${markdownEscape(record.sourceDocument.section)}` : ""}`
      : "—";
    lines.push(`| ${record.id} | ${markdownEscape(record.category ?? "—")} | ${markdownEscape(record.app)} | ${record.priority} | ${markdownEscape(record.status)} | ${markdownEscape(record.title)} | ${markdownEscape(record.impact)} | ${renderEvidence(record)} | ${source} | ${markdownEscape(proposal)} | ${renderVerification(record)} |`);
  }
  return lines.join("\n");
}

export function renderReport(records) {
  const sorted = [...records].sort(compareRecords);
  const counts = (predicate) => sorted.filter(predicate).length;
  const lines = [
    "# 残課題レポート",
    "",
    "> `docs/backlog/findings.jsonl` から生成。直接編集しない。",
    "",
    "## サマリー",
    "",
    `- 総数: ${sorted.length}`,
    `- 優先度: P1 ${counts((record) => record.priority === "P1")} / P2 ${counts((record) => record.priority === "P2")} / P3 ${counts((record) => record.priority === "P3")}`,
    `- カテゴリ: ${CATEGORY_VALUES.filter((category) => counts((record) => record.category === category) > 0).map((category) => `${category} ${counts((record) => record.category === category)}`).join(" / ") || "該当なし"}`,
    `- 状態: discovered ${counts((record) => record.status === "discovered")} / triaged ${counts((record) => record.status === "triaged")} / in-progress ${counts((record) => record.status === "in-progress")} / monitoring ${counts((record) => record.status === "monitoring")} / verified ${counts((record) => record.status === "verified")} / wont-fix ${counts((record) => record.status === "wont-fix")}`,
    "",
    "## 要対応",
    "",
    renderTable(sorted.filter((record) => ["P1", "P2"].includes(record.priority) && !isSuppressed(record))),
    "",
    "## 抑止中（再検出しても登録しない）",
    "",
    renderTable(sorted.filter((record) => record.status !== "wont-fix" && record.suppress?.until && isSuppressed(record))),
    "",
    "## 全件一覧",
    "",
    renderTable(sorted),
    "",
    "## 実画面未確認一覧",
    "",
    renderTable(sorted.filter((record) => isUnverified(record))),
    "",
    "## 異常発生時確認待ち",
    "",
    renderTable(sorted.filter((record) => record.status === "monitoring")),
    "",
    "## 対応済み履歴",
    "",
    renderTable(sorted.filter((record) => record.status === "verified")),
    "",
    "## wont-fix 一覧",
    "",
    renderTable(sorted.filter((record) => record.status === "wont-fix")),
    ""
  ];
  return lines.join("\n");
}

async function writeReport(records) {
  await atomicWrite(REPORT_FILE, renderReport(records));
}

// JSON 入力で受け付けるキー。CLI のオプション名に加え、findings.jsonl のフィールド名(camelCase)も使える。
const ADD_INPUT_OPTIONS = new Set([
  "category", "app", "area", "priority", "title", "finding", "impact", "proposal",
  "verification-required", "acceptance-criteria", "evidence", "source-document", "commit", "tag", "allow-similar"
]);
const ADD_INPUT_ALIASES = { tags: "tag", relatedCommits: "commit", commits: "commit" };
const ADD_INPUT_FLAGS = new Set(["allow-similar"]);
// --input と併用できるのは、全件に効く実行制御だけにする。項目の値は入力ファイル側に一本化する。
const ADD_BATCH_CONTROL_OPTIONS = new Set(["input", "run", "dry-run", "json", "allow-similar"]);

function inputValueToOption(name, value, where) {
  if (ADD_INPUT_FLAGS.has(name)) {
    if (typeof value !== "boolean") fail(`${where} must be a boolean`);
    return value;
  }
  // 根拠と元文書はオブジェクトでも渡せる。CLI と同じ "file:lines" / "file#section" へ寄せて検査を共有する。
  if (name === "evidence" && value && typeof value === "object") {
    if (value.type !== undefined && value.type !== "code") fail(`${where}.type must be code`);
    return `${value.file ?? ""}${value.lines ? `:${value.lines}` : ""}`;
  }
  if (name === "source-document" && value && typeof value === "object") {
    return `${value.file ?? ""}${value.section ? `#${value.section}` : ""}`;
  }
  if (typeof value !== "string") fail(`${where} must be a string`);
  return value;
}

export function addInputToOptions(entry, index = 0) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`input[${index}] must be an object`);
  const optionsMap = new Map();
  for (const [key, raw] of Object.entries(entry)) {
    const name = ADD_INPUT_ALIASES[key] ?? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    if (!ADD_INPUT_OPTIONS.has(name)) fail(`input[${index}] has unknown key: ${key}`);
    const values = Array.isArray(raw) ? raw : [raw];
    const converted = values.map((value, position) => inputValueToOption(name, value, `input[${index}].${key}${Array.isArray(raw) ? `[${position}]` : ""}`));
    if (ADD_INPUT_FLAGS.has(name)) {
      if (converted.at(-1)) optionsMap.set(name, [true]);
      continue;
    }
    optionsMap.set(name, converted);
  }
  return optionsMap;
}

export function parseAddInput(text) {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    fail(`invalid add input JSON: ${error.message}`);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (!entries.length) fail("add input must contain at least one finding");
  return entries.map((entry, index) => addInputToOptions(entry, index));
}

async function readAddInput(source) {
  if (source === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return fs.readFile(path.resolve(process.cwd(), source), "utf8");
}

function buildDraft(optionsMap) {
  const draft = {
    createdAt: today(),
    updatedAt: today(),
    category: option(optionsMap, "category", { defaultValue: "architecture" }),
    app: nonEmptyString(option(optionsMap, "app", { required: true }), "app"),
    area: nonEmptyString(option(optionsMap, "area", { required: true }), "area"),
    priority: nonEmptyString(option(optionsMap, "priority", { required: true }), "priority"),
    status: "discovered",
    title: nonEmptyString(option(optionsMap, "title", { required: true }), "title"),
    finding: nonEmptyString(option(optionsMap, "finding", { required: true }), "finding"),
    impact: nonEmptyString(option(optionsMap, "impact", { required: true }), "impact"),
    verificationRequired: option(optionsMap, "verification-required", { defaultValue: "code" }),
    acceptanceCriteria: stringArray(optionList(optionsMap, "acceptance-criteria"), "acceptance-criteria"),
    evidence: optionList(optionsMap, "evidence").map(parseEvidence),
    proposal: nonEmptyString(option(optionsMap, "proposal", { required: true }), "proposal"),
    verification: [],
    workNotes: [],
    decision: null,
    relatedCommits: optionList(optionsMap, "commit"),
    tags: optionList(optionsMap, "tag")
  };
  if (hasOption(optionsMap, "source-document")) draft.sourceDocument = parseSourceDocument(option(optionsMap, "source-document"));
  return draft;
}

// records を書き換えずに1件分の追加結果を返す。バッチでは前の件の結果を次の件の入力にする。
export function planAdd(records, optionsMap, { runId, allowSimilar = false } = {}) {
  const draft = buildDraft(optionsMap);
  draft.id = nextId(records);

  // 同一 fingerprint は新規追加しない。再検出として既存項目へ寄せる（設計 §2.4）。
  const existing = findByFingerprint(records, computeFingerprint(draft));
  if (existing && !allowSimilar) {
    const nextRecords = records.map((record) => {
      if (record !== existing) return record;
      return {
        ...record,
        workNotes: [...(record.workNotes ?? []), { date: today(), note: `再検出${runId ? `（${runId}）` : ""}: ${draft.title}` }],
        updatedAt: today()
      };
    });
    return { records: nextRecords, outcome: isSuppressed(existing) ? "suppressed" : "re-detected", id: existing.id, detail: existing.status };
  }

  const candidates = duplicateCandidates(records, draft);
  if (candidates.length && !allowSimilar) {
    fail(`similar finding exists: ${candidates.map((record) => `${record.id} ${record.title}`).join("; ")}; use --allow-similar to add anyway`);
  }
  if (runId) draft.tags = [...new Set([...draft.tags, runId])];
  return { records: [...records, draft], outcome: "added", id: draft.id, detail: null };
}

async function commandAdd(optionsMap) {
  let entries = [optionsMap];
  if (hasOption(optionsMap, "input")) {
    const extra = [...optionsMap.keys()].filter((name) => !ADD_BATCH_CONTROL_OPTIONS.has(name));
    if (extra.length) fail(`--input cannot be combined with field options: ${extra.map((name) => `--${name}`).join(", ")}`);
    entries = parseAddInput(await readAddInput(option(optionsMap, "input", { required: true })));
  }

  const runId = option(optionsMap, "run");
  const dryRun = hasOption(optionsMap, "dry-run");
  const emit = (outcome, id, detail) => {
    if (hasOption(optionsMap, "json")) console.log(JSON.stringify({ outcome, id, detail: detail ?? null }));
    else console.log(`${id} ${outcome}${detail ? ` (${detail})` : ""}`);
  };

  await withLock(async () => {
    let records = await readFindings();
    const results = [];
    for (const [index, entryOptions] of entries.entries()) {
      const allowSimilar = hasOption(optionsMap, "allow-similar") || hasOption(entryOptions, "allow-similar");
      try {
        const result = planAdd(records, entryOptions, { runId, allowSimilar });
        records = result.records;
        results.push(result);
      } catch (error) {
        // 1件でも失敗したら何も書き込まない。途中まで登録された状態を残さない。
        fail(entries.length > 1 ? `input[${index}]: ${error.message}` : error.message);
      }
    }
    validateRecords(records);
    if (!dryRun) {
      await atomicWrite(FINDINGS_FILE, toJsonl(records));
      await writeReport(records);
    }
    for (const { outcome, id, detail } of results) emit(dryRun && outcome === "added" ? "would-add" : outcome, id, detail);
  });
}

async function commandSuppress(positionals, optionsMap) {
  const id = positionals[0];
  if (!id) fail("usage: npm run backlog:suppress -- BL-001 --until 2026-12-01 --reason \"…\" | --clear");
  await withLock(async () => {
    const records = await readFindings();
    const record = getRecord(records, id);
    if (hasOption(optionsMap, "clear")) {
      record.suppress = null;
    } else {
      const until = option(optionsMap, "until", { required: true });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) fail(`--until must be an ISO date: ${until}`);
      if (until < today()) fail(`--until is already in the past: ${until}`);
      record.suppress = { until, reason: nonEmptyString(option(optionsMap, "reason", { required: true }), "reason"), createdAt: today() };
    }
    record.updatedAt = today();
    validateRecords(records);
    await atomicWrite(FINDINGS_FILE, toJsonl(records));
    await writeReport(records);
    console.log(`${id} ${hasOption(optionsMap, "clear") ? "suppression cleared" : `suppressed until ${record.suppress.until}`}`);
  });
}

function filteredRecords(records, optionsMap) {
  const category = option(optionsMap, "category");
  const priority = option(optionsMap, "priority");
  const status = option(optionsMap, "status");
  const app = option(optionsMap, "app");
  return records.filter((record) => (!category || record.category === category)
    && (!priority || record.priority === priority)
    && (!status || record.status === status)
    && (!app || record.app === app)
    && (!hasOption(optionsMap, "unverified") || isUnverified(record)));
}

async function commandList(optionsMap) {
  const records = filteredRecords(validateRecords(await readFindings()), optionsMap);
  if (hasOption(optionsMap, "json")) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  if (!records.length) {
    console.log("該当なし");
    return;
  }
  for (const record of records.sort(compareRecords)) console.log(`${record.id}\t${record.category}\t${record.priority}\t${record.status}\t${record.app}\t${record.title}`);
}

// 1件の全フィールドを出す。--ascii は非ASCIIを \uXXXX にして、標準出力の文字コードに左右されない形にする。
async function commandShow(positionals, optionsMap) {
  if (!positionals.length) fail("usage: npm run backlog:show -- BL-001 [BL-002 …] [--ascii]");
  const records = validateRecords(await readFindings());
  const selected = positionals.map((id) => getRecord(records, id));
  const json = JSON.stringify(selected.length === 1 ? selected[0] : selected, null, 2);
  console.log(hasOption(optionsMap, "ascii") ? toAsciiJson(json) : json);
}

export function toAsciiJson(json) {
  return json.replace(/[^\x00-\x7f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function getRecord(records, id) {
  const matches = records.filter((record) => record.id === id);
  if (matches.length !== 1) fail(`expected exactly one record for ${id}, found ${matches.length}`);
  return matches[0];
}

function applyStatusChange(record, nextStatus) {
  if (!STATUS_VALUES.includes(nextStatus)) fail(`invalid status: ${nextStatus}`);
  if (!canTransition(record.status, nextStatus)) fail(`invalid status transition: ${record.status} -> ${nextStatus}`);
  record.status = nextStatus;
}

async function commandUpdate(positionals, optionsMap) {
  const id = positionals[0];
  if (!id) fail("usage: npm run backlog:update -- BL-001 [options]");
  await withLock(async () => {
    const records = await readFindings();
    const record = getRecord(records, id);
    if (hasOption(optionsMap, "status")) applyStatusChange(record, option(optionsMap, "status"));
    for (const field of ["category", "app", "area", "priority", "title", "finding", "impact", "proposal", "verification-required"]) {
      if (hasOption(optionsMap, field)) record[field === "verification-required" ? "verificationRequired" : field] = option(optionsMap, field);
    }
    if (hasOption(optionsMap, "source-document")) record.sourceDocument = parseSourceDocument(option(optionsMap, "source-document"));
    if (hasOption(optionsMap, "acceptance-criteria")) record.acceptanceCriteria = stringArray(optionList(optionsMap, "acceptance-criteria"), "acceptance-criteria");
    if (hasOption(optionsMap, "evidence")) record.evidence = optionList(optionsMap, "evidence").map(parseEvidence);
    if (hasOption(optionsMap, "work-note")) {
      record.workNotes ??= [];
      record.workNotes.push({ date: today(), note: nonEmptyString(option(optionsMap, "work-note"), "work-note") });
    }
    if (hasOption(optionsMap, "commit")) record.relatedCommits = [...new Set([...(record.relatedCommits ?? []), ...optionList(optionsMap, "commit")])];
    if (hasOption(optionsMap, "tag")) record.tags = [...new Set([...(record.tags ?? []), ...optionList(optionsMap, "tag")])];
    if (hasOption(optionsMap, "untag")) {
      const removed = new Set(optionList(optionsMap, "untag"));
      record.tags = (record.tags ?? []).filter((tag) => !removed.has(tag));
    }
    if (hasOption(optionsMap, "reason")) record.decision = { reason: nonEmptyString(option(optionsMap, "reason"), "reason"), decidedAt: today() };
    record.updatedAt = today();
    validateRecords(records);
    await atomicWrite(FINDINGS_FILE, toJsonl(records));
    await writeReport(records);
    console.log(`${id} updated`);
  });
}

async function commandVerify(positionals, optionsMap) {
  const id = positionals[0];
  if (!id) fail("usage: npm run backlog:verify -- BL-001 --method code|manual --result passed|failed|not-checked");
  const method = option(optionsMap, "method", { required: true });
  const result = option(optionsMap, "result", { required: true });
  if (!VERIFICATION_METHOD_VALUES.includes(method)) fail(`invalid verification method: ${method}`);
  if (!VERIFICATION_RESULT_VALUES.includes(result)) fail(`invalid verification result: ${result}`);
  const entry = { method, result, checkedAt: today() };
  if (hasOption(optionsMap, "notes")) entry.notes = option(optionsMap, "notes");
  if (method === "manual") {
    entry.screen = nonEmptyString(option(optionsMap, "screen", { required: true }), "screen");
    entry.viewport = nonEmptyString(option(optionsMap, "viewport", { required: true }), "viewport");
    entry.steps = stringArray(optionList(optionsMap, "step"), "step");
    if (!entry.steps.length) fail("manual verification needs at least one --step");
    entry.observed = nonEmptyString(option(optionsMap, "observed", { required: true }), "observed");
    if (hasOption(optionsMap, "screenshot")) entry.screenshot = normalizeRepoPath(option(optionsMap, "screenshot"));
  }
  await withLock(async () => {
    const records = await readFindings();
    const record = getRecord(records, id);
    record.verification ??= [];
    record.verification.push(entry);
    record.updatedAt = today();
    validateRecords(records);
    await atomicWrite(FINDINGS_FILE, toJsonl(records));
    await writeReport(records);
    console.log(`${id} verification recorded`);
  });
}

async function commandReport() {
  const records = validateRecords(await readFindings());
  await writeReport(records);
  console.log(`report written: ${path.relative(REPO_ROOT, REPORT_FILE)}`);
}

async function commandValidate(optionsMap) {
  const records = validateRecords(await readFindings());
  if (hasOption(optionsMap, "report")) {
    let current;
    try {
      current = await fs.readFile(REPORT_FILE, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") fail(`report is missing: ${path.relative(REPO_ROOT, REPORT_FILE)}`);
      throw error;
    }
    const expected = renderReport(records);
    if (current !== expected) fail("report is stale: run npm run backlog:report");
  }
  console.log(`validated ${records.length} finding(s)${hasOption(optionsMap, "report") ? " and report" : ""}`);
}

export async function main(argv = process.argv.slice(2)) {
  const { command, positionals, options: optionsMap } = parseArgs(argv);
  switch (command) {
    case "add":
      await commandAdd(optionsMap);
      break;
    case "list":
      await commandList(optionsMap);
      break;
    case "show":
      await commandShow(positionals, optionsMap);
      break;
    case "update":
      await commandUpdate(positionals, optionsMap);
      break;
    case "verify":
      await commandVerify(positionals, optionsMap);
      break;
    case "suppress":
      await commandSuppress(positionals, optionsMap);
      break;
    case "report":
      await commandReport();
      break;
    case "validate":
      await commandValidate(optionsMap);
      break;
    default:
      fail(`unknown command: ${command}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`backlog: ${error.message}`);
    process.exitCode = 1;
  });
}
