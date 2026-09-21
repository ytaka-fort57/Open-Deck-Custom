// 決定論チェック。LLM に数えさせていた観点をツール側へ移す（設計 §2.6）。
// 各チェックは { file, line, message, hint } の配列を返す純粋関数に近い形にしてある。
// ctx = { files: string[](リポジトリ相対), read(file): Promise<string> }
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_EXCLUDE, matchesAny, readLenses, REPO_ROOT } from "./review-lenses.mjs";
import { REVIEW_CONFIG } from "./review-config.mjs";

function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

// 意図的な逸脱は `review-checks: allow <check-id> — 理由` を当該行かその直前 2 行に書いて黙らせる。
// 恒久的に鳴り続けるチェックは無視されるようになるため、逃げ道を用意しておく。
export function isAllowed(content, line, checkId) {
  const lines = content.split("\n");
  const start = Math.max(0, line - 3);
  return lines.slice(start, line).some((entry) => entry.includes(`review-checks: allow ${checkId}`));
}

// 開き括弧から対応する閉じ括弧までを返す。文字列・テンプレートの中は数えない。
function balancedSlice(content, openIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    const previous = content[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{") depth += 1;
    if (char === ")" || char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(openIndex, index + 1);
    }
  }
  return content.slice(openIndex);
}

const sqlInjection = {
  id: "sql-injection",
  title: "SQL 直挿入",
  scope: ["src/**/*.mjs"],
  async run({ files, read }) {
    const issues = [];
    for (const file of files) {
      const content = await read(file);
      const pattern = /\.(exec|prepare)\s*\(/g;
      let match;
      while ((match = pattern.exec(content))) {
        const call = balancedSlice(content, match.index + match[0].length - 1);
        const interpolations = [...call.matchAll(/\$\{([^}]*)\}/g)].map((entry) => entry[1].trim());
        // `IN (${placeholders})` は ? を並べる定型。ここを鳴らし続けると検査全体が無視される。
        const onlyPlaceholders = interpolations.length > 0 && interpolations.every((expression) => /^[A-Za-z_$][\w$]*$/.test(expression) && /placeholder/i.test(expression));
        const interpolated = interpolations.length > 0 && !onlyPlaceholders;
        const concatenated = /["'`]\s*\+|\+\s*["'`]/.test(call);
        if (!interpolated && !concatenated) continue;
        const line = lineOf(content, match.index);
        if (isAllowed(content, line, "sql-injection")) continue;
        issues.push({
          file,
          line,
          message: `${match[1]}() の SQL に${interpolated ? "テンプレート埋め込み" : "文字列連結"}がある`,
          hint: "プレースホルダ（?）とバインド引数へ置き換える。識別子を埋める場合は許可リストで固定する"
        });
      }
    }
    return issues;
  }
};

const hardcodedPath = {
  id: "hardcoded-path",
  title: "ハードコード絶対パス",
  scope: ["*.js", "extensions/**/*.js", "scripts/**/*.mjs"],
  async run({ files, read }) {
    const issues = [];
    for (const file of files) {
      const content = await read(file);
      for (const [index, line] of content.split("\n").entries()) {
        if (isCommentLine(line)) continue;
        if (!/(["'`])(?:[A-Za-z]:[\\/]|\/[A-Za-z]:\/)/.test(line)) continue;
        if (isAllowed(content, index + 1, "hardcoded-path")) continue;
        issues.push({
          file,
          line: index + 1,
          message: "絶対パス（ドライブレター）が文字列リテラルに埋まっている",
          hint: "REPO_ROOT や os.homedir() からの相対解決へ置き換える"
        });
      }
    }
    return issues;
  }
};

const CSS_LINE_THRESHOLD = 800;

const cssDuplication = {
  id: "css-duplication",
  title: "CSS 重複セレクタと肥大化",
  scope: ["ui/*.css", "tray/*.css"],
  async run({ files, read }) {
    const issues = [];
    for (const file of files) {
      const content = await read(file);
      const lines = content.split("\n");
      if (lines.length > CSS_LINE_THRESHOLD) {
        issues.push({
          file,
          line: lines.length,
          message: `${lines.length} 行（閾値 ${CSS_LINE_THRESHOLD} 行）`,
          hint: "セクション分割か、重複セレクタの統合を検討する"
        });
      }
      // インデント 0 で `{` で終わる行だけを最上位セレクタとみなす。
      // メディアクエリ内の再定義は意図的な上書きなので数えない。
      const seen = new Map();
      for (const [index, line] of lines.entries()) {
        if (/^[ \t]/.test(line)) continue;
        const match = line.match(/^([^@{}/][^{}]*?)\s*\{\s*$/);
        if (!match) continue;
        const selector = match[1].trim().replace(/\s+/g, " ");
        if (!selector) continue;
        if (seen.has(selector)) {
          // UX-037: 意図的な上書きは他のチェックと同じ allow コメントで黙らせる。
          if (isAllowed(content, index + 1, "css-duplication")) continue;
          issues.push({
            file,
            line: index + 1,
            message: `セレクタ ${selector} が ${seen.get(selector)} 行目と重複している`,
            hint: "同じセレクタの宣言をまとめるか、片方を削除する"
          });
          continue;
        }
        seen.set(selector, index + 1);
      }
    }
    return issues;
  }
};

const connectorDirection = {
  id: "connector-direction",
  title: "コネクタ direction 欠落",
  scope: ["src/connectors/*.mjs"],
  exclude: ["src/connectors/shared/**"],
  async run({ files, read }) {
    const issues = [];
    for (const file of files) {
      const content = await read(file);
      const spreadSources = collectDirectionBearingObjects(content);
      const pattern = /(snapshots|metrics)\.push\s*\(\s*\{/g;
      let match;
      while ((match = pattern.exec(content))) {
        const block = balancedSlice(content, content.indexOf("{", match.index));
        if (/\bdirection\s*:/.test(block)) continue;
        // UX-038: base オブジェクトに direction を置いて ...base で展開する書き方も認める。
        if (spreadsDirection(block, spreadSources)) continue;
        issues.push({
          file,
          line: lineOf(content, match.index),
          message: `${match[1]}.push に direction がない`,
          hint: "増加が良いか悪いかを direction で明示する（UI の色分けに使われる）"
        });
      }
    }
    return issues;
  }
};

// UX-038: `const base = { ..., direction: "increasing" }` のように
// direction を持つオブジェクトへ束縛された識別子を集める。
function collectDirectionBearingObjects(content) {
  const names = new Set();
  const pattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let match;
  while ((match = pattern.exec(content))) {
    const block = balancedSlice(content, content.indexOf("{", match.index));
    if (/\bdirection\s*:/.test(block)) {
      names.add(match[1]);
    }
  }
  return names;
}

function spreadsDirection(block, spreadSources) {
  const pattern = /\.\.\.\s*([A-Za-z_$][\w$]*)/g;
  let match;
  while ((match = pattern.exec(block))) {
    if (spreadSources.has(match[1])) return true;
  }
  return false;
}

const docsLinks = {
  id: "docs-links",
  title: "ドキュメントのリンク切れ",
  scope: ["*.md", "docs/**/*.md", ".claude/**/*.md", ".agents/**/*.md"],
  async run({ files, read, exists }) {
    const issues = [];
    for (const file of files) {
      const content = await read(file);
      const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      let match;
      while ((match = pattern.exec(content))) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#|<)/.test(target)) continue;
        const [relative] = target.split("#");
        if (!relative) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURI(relative)));
        if (resolved.startsWith("..")) {
          issues.push({ file, line: lineOf(content, match.index), message: `リンクがリポジトリ外を指している: ${target}`, hint: "リポジトリ相対に直す" });
          continue;
        }
        if (await exists(resolved)) continue;
        issues.push({
          file,
          line: lineOf(content, match.index),
          message: `リンク先が存在しない: ${target}`,
          hint: "移動先へ貼り替えるか、参照ごと削除する"
        });
      }
    }
    return issues;
  }
};

const evidenceStale = {
  id: "evidence-stale",
  title: "バックログ根拠の陳腐化",
  scope: [REVIEW_CONFIG.paths.findings],
  async run({ files, read, exists }) {
    const issues = [];
    for (const file of files) {
      const content = await read(file);
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (["verified", "wont-fix"].includes(record.status)) continue;
        for (const entry of record.evidence ?? []) {
          if (entry.type !== "code") continue;
          if (!(await exists(entry.file))) {
            issues.push({ file, line: 0, message: `${record.id} の根拠ファイルが存在しない: ${entry.file}`, hint: "npm run backlog:update -- <ID> --evidence <新しいパス> で取り直す" });
            continue;
          }
          if (!entry.lines) continue;
          const total = (await read(entry.file)).split("\n").length;
          const end = Number(entry.lines.split("-").at(-1));
          if (end <= total) continue;
          issues.push({
            file,
            line: 0,
            message: `${record.id} の根拠行が範囲外: ${entry.file}:${entry.lines}（実ファイルは ${total} 行）`,
            hint: "npm run backlog:update -- <ID> --evidence <パス:行> で取り直す"
          });
        }
      }
    }
    return issues;
  }
};

export const CHECKS = [hardcodedPath, docsLinks, evidenceStale];

export function getCheck(id) {
  const check = CHECKS.find((entry) => entry.id === id);
  if (!check) throw new Error(`unknown check: ${id}`);
  return check;
}

export async function listRepoFiles(root = REPO_ROOT) {
  const results = [];
  async function walk(relative) {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (matchesAny(child, GLOBAL_EXCLUDE) || matchesAny(`${child}/**`, GLOBAL_EXCLUDE)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(child);
        continue;
      }
      results.push(child);
    }
  }
  await walk("");
  return results.sort();
}

export function createFsContext(root = REPO_ROOT, files = []) {
  return {
    files,
    read: (file) => fs.readFile(path.join(root, file), "utf8"),
    exists: (file) => fs.access(path.join(root, file)).then(() => true, () => false)
  };
}

export function scopeFor(check, allFiles, overrideScope) {
  const scope = overrideScope ?? check.scope;
  const exclude = [...GLOBAL_EXCLUDE, ...(check.exclude ?? [])];
  return allFiles.filter((file) => matchesAny(file, scope) && !matchesAny(file, exclude));
}

export async function runChecks(ids, { root = REPO_ROOT, files = null } = {}) {
  const allFiles = files ?? await listRepoFiles(root);
  const results = [];
  for (const id of ids) {
    const check = getCheck(id);
    const files = scopeFor(check, allFiles);
    const context = createFsContext(root, files);
    const issues = await check.run(context);
    results.push({ check: check.id, title: check.title, scanned: files.length, issues });
  }
  return results;
}

const VALUE_OPTIONS = new Set(["check", "lens"]);
const FLAG_OPTIONS = new Set(["json", "strict"]);

export function parseCliArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (!VALUE_OPTIONS.has(name) && !FLAG_OPTIONS.has(name)) throw new Error(`unknown option: --${name}`);
    if (options.has(name)) throw new Error(`duplicate option: --${name}`);
    const next = argv[index + 1];
    if (VALUE_OPTIONS.has(name)) {
      if (!next || next.startsWith("--")) throw new Error(`--${name} requires a value`);
      options.set(name, argv[++index]);
      continue;
    }
    options.set(name, true);
  }
  return options;
}

export function resolveCheckIds(options, lenses = []) {
  const requestedCheck = options.get("check");
  const requestedLens = options.get("lens");
  if (requestedCheck && requestedLens) throw new Error("--check and --lens cannot be used together");
  if (requestedLens) {
    const lens = lenses.find((entry) => entry.id === requestedLens);
    if (!lens) throw new Error(`unknown lens: ${requestedLens}`);
    if (lens.mode !== "deterministic") throw new Error(`lens is not deterministic: ${requestedLens}`);
    getCheck(lens.check);
    return [lens.check];
  }
  if (requestedCheck) {
    const ids = [...new Set(requestedCheck.split(",").map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) throw new Error("--check requires at least one check id");
    ids.forEach(getCheck);
    return ids;
  }
  return CHECKS.map((check) => check.id);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const lenses = options.has("lens") ? await readLenses() : [];
  const ids = resolveCheckIds(options, lenses);
  const results = await runChecks(ids);
  if (options.has("json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      if (!result.issues.length) {
        console.log(`[OK] ${result.check} — 問題なし（${result.scanned} ファイル）`);
        continue;
      }
      for (const issue of result.issues) {
        console.log(`[WARN] ${issue.file}${issue.line ? `:${issue.line}` : ""} — ${issue.message}`);
        console.log(`  推奨対処: ${issue.hint}`);
      }
      console.log(`[SUM] ${result.check} — ${result.issues.length} 件（${result.scanned} ファイル）`);
    }
  }
  const total = results.reduce((sum, result) => sum + result.issues.length, 0);
  if (total > 0 && options.has("strict")) process.exitCode = 1;
  return total;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`review-checks: ${error.message}`);
    process.exitCode = 1;
  });
}
