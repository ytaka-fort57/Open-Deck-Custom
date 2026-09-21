// レビュー観点（レンズ）台帳の読み書きと選択。
// 正本の場所は review.config.json で指定する。観点そのものはデータとして持つ。
// 設計: docs/dev/automated-review-cycle-design-2026-09-16.md §2.1
import { promises as fs } from "node:fs";
import path from "node:path";
import { IMMUTABLE_EXCLUDE, REPO_ROOT, REVIEW_CONFIG, REVIEW_PATHS } from "./review-config.mjs";

export { REPO_ROOT };
export const LENSES_FILE = REVIEW_PATHS.lenses;

export const CADENCE_DAYS = {
  "on-change": 0,
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 91
};

export const CADENCE_VALUES = Object.keys(CADENCE_DAYS);
export const LENS_MODE_VALUES = ["llm", "deterministic"];

// レンズ 1 件が 1 サイクルで登録してよい既定上限。バックログ氾濫の防止（設計 §2.10）。
export const DEFAULT_MAX_FINDINGS = REVIEW_CONFIG.limits.maxFindingsPerRun;

// どのレンズからも恒久的に外すパス。認証情報と生成物は走査対象にしない。
export const GLOBAL_EXCLUDE = [
  ...IMMUTABLE_EXCLUDE,
  `${path.posix.dirname(REVIEW_CONFIG.paths.findings)}/evidence/**`
];

function fail(message) {
  throw new Error(message);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateLens(lens, index) {
  const label = lens?.id ?? `lens ${index + 1}`;
  if (!lens || typeof lens !== "object" || Array.isArray(lens)) fail(`${label} must be an object`);
  if (!/^LENS-[a-z0-9-]+$/.test(lens.id ?? "")) fail(`${label} has an invalid id (expected LENS-kebab-case)`);
  nonEmptyString(lens.title, `${label}.title`);
  nonEmptyString(lens.category, `${label}.category`);
  if (!REVIEW_CONFIG.vocabulary.categories.includes(lens.category)) fail(`${label}.category is not configured: ${lens.category}`);
  if (!CADENCE_VALUES.includes(lens.cadence)) fail(`${label}.cadence is invalid: ${lens.cadence}`);
  if (!LENS_MODE_VALUES.includes(lens.mode)) fail(`${label}.mode is invalid: ${lens.mode}`);
  if (!Array.isArray(lens.scope) || lens.scope.length === 0) fail(`${label}.scope must not be empty`);
  lens.scope.forEach((pattern, position) => nonEmptyString(pattern, `${label}.scope[${position}]`));
  if (lens.exclude !== undefined) {
    if (!Array.isArray(lens.exclude)) fail(`${label}.exclude must be an array`);
    lens.exclude.forEach((pattern, position) => nonEmptyString(pattern, `${label}.exclude[${position}]`));
  }
  if (lens.mode === "llm") nonEmptyString(lens.prompt, `${label}.prompt`);
  if (lens.mode === "deterministic") nonEmptyString(lens.check, `${label}.check`);
  if (lens.maxFindings !== undefined && (!Number.isInteger(lens.maxFindings) || lens.maxFindings < 1)) {
    fail(`${label}.maxFindings must be a positive integer`);
  }
  if (lens.lastRunAt !== null && lens.lastRunAt !== undefined && !isIsoDate(lens.lastRunAt)) {
    fail(`${label}.lastRunAt must be null or an ISO date`);
  }
  if (typeof lens.enabled !== "boolean") fail(`${label}.enabled must be a boolean`);
  if (lens.app !== undefined) {
    nonEmptyString(lens.app, `${label}.app`);
    if (!REVIEW_CONFIG.vocabulary.components.includes(lens.app)) fail(`${label}.app is not configured: ${lens.app}`);
  }
  if (lens.area !== undefined) {
    nonEmptyString(lens.area, `${label}.area`);
    if (!REVIEW_CONFIG.vocabulary.areas.includes(lens.area)) fail(`${label}.area is not configured: ${lens.area}`);
  }
  return lens;
}

export function validateLenses(lenses) {
  const ids = new Set();
  lenses.forEach((lens, index) => {
    validateLens(lens, index);
    if (ids.has(lens.id)) fail(`duplicate lens id: ${lens.id}`);
    ids.add(lens.id);
  });
  return lenses;
}

export function parseLenses(content) {
  const lenses = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("//")) continue;
    try {
      lenses.push(JSON.parse(line));
    } catch (error) {
      fail(`invalid JSONL at ${REVIEW_CONFIG.paths.lenses} line ${index + 1}: ${error.message}`);
    }
  }
  return validateLenses(lenses);
}

export function serializeLenses(lenses) {
  return lenses.map((lens) => JSON.stringify(lens)).join("\n") + (lenses.length ? "\n" : "");
}

export async function readLenses(file = LENSES_FILE) {
  return parseLenses(await fs.readFile(file, "utf8"));
}

export function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) fail(`invalid date: ${from} / ${to}`);
  return Math.round((end - start) / 86_400_000);
}

export function maxFindingsOf(lens) {
  return lens.maxFindings ?? DEFAULT_MAX_FINDINGS;
}

export function lensStaleness(lens, today) {
  if (!lens.lastRunAt) return Number.POSITIVE_INFINITY;
  return daysBetween(lens.lastRunAt, today);
}

export function isDue(lens, today) {
  if (!lens.enabled) return false;
  return lensStaleness(lens, today) >= CADENCE_DAYS[lens.cadence];
}

// 期限到来のレンズを「放置が長い順 → id 順」で返す。
// 毎回同じレンズを引かないことで「異なる観点から」を担保する（設計 §2.1）。
export function dueLenses(lenses, today, { mode } = {}) {
  return lenses
    .filter((lens) => (!mode || lens.mode === mode) && isDue(lens, today))
    .sort((left, right) => {
      const diff = lensStaleness(right, today) - lensStaleness(left, today);
      if (Number.isNaN(diff) || diff === 0) return left.id.localeCompare(right.id);
      if (diff === Number.POSITIVE_INFINITY) return 1;
      if (diff === Number.NEGATIVE_INFINITY) return -1;
      return diff;
    });
}

export function selectLenses(lenses, today, { limit = 1, mode, id } = {}) {
  if (id) {
    const lens = lenses.find((entry) => entry.id === id);
    if (!lens) fail(`unknown lens: ${id}`);
    return [lens];
  }
  return dueLenses(lenses, today, { mode }).slice(0, limit);
}

// 最小 glob。`**` は階層跨ぎ、`*` は 1 階層内、`?` は 1 文字。
export function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        const skipSlash = pattern[index + 2] === "/";
        index += skipSlash ? 2 : 1;
        source += skipSlash ? "(?:.*/)?" : ".*";
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

export function filterByScope(files, lens) {
  const exclude = [...GLOBAL_EXCLUDE, ...(lens.exclude ?? [])];
  return files.filter((file) => matchesAny(file, lens.scope) && !matchesAny(file, exclude));
}
