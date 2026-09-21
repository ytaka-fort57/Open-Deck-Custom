// review.config.json の副作用なしローダー。doctor は設定が壊れていてもこの層で診断する。
import { promises as fs } from "node:fs";
import path from "node:path";

const TOP_LEVEL_KEYS = ["schemaVersion", "paths", "vocabulary", "limits", "verification"];
const PATH_KEYS = ["lenses", "findings", "runs", "fixes", "report", "health", "autofixPolicy"];
const VOCABULARY_KEYS = ["findingIdPrefix", "categories", "components", "areas"];
const LIMIT_KEYS = ["maxFindingsPerRun", "maxScannedFiles", "maxDurationMinutes", "staleLockMinutes"];

export const IMMUTABLE_EXCLUDE = [
  "node_modules/**", ".git/**", ".claude/worktrees/**", "playwright-report/**", "test-results/**", "package/**",
  "data/**", "**/*.db", ".env*", "**/*credentials*.json",
  "**/*token*.json", "usage-accounts.json", "package-lock.json", "review.config.json",
  "review/autofix-policy.json", "scripts/review-*.mjs", "tests/review/**", ".github/workflows/**"
];

function fail(message) { throw new Error(`review config: ${message}`); }
function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}
function exactKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${field} has unknown key(s): ${unknown.join(", ")}`);
  const missing = allowed.filter((key) => value[key] === undefined);
  if (missing.length) fail(`${field} is missing key(s): ${missing.join(", ")}`);
}
function stringList(value, field) {
  if (!Array.isArray(value) || !value.length) fail(`${field} must be a non-empty array`);
  const normalized = value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) fail(`${field}[${index}] must be a non-empty string`);
    return entry.trim();
  });
  if (new Set(normalized).size !== normalized.length) fail(`${field} must not contain duplicates`);
  return normalized;
}
function relativeRepoPath(value, field, root) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  if (path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) fail(`${field} must be repository-relative`);
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) fail(`${field} contains an invalid path segment`);
  const relative = path.relative(root, path.resolve(root, ...normalized.split("/")));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail(`${field} must resolve inside the repository`);
  return normalized;
}
function isImmutableTarget(value) {
  const normalized = value.toLowerCase();
  const basename = path.posix.basename(normalized);
  return normalized.startsWith("node_modules/") || normalized.startsWith(".git/") || normalized.startsWith("data/")
    || normalized.startsWith(".github/workflows/") || ["usage-accounts.json", "package-lock.json", "review.config.json", "review/autofix-policy.json", "scripts/review-config.mjs", "scripts/review-autofix.mjs"].includes(normalized)
    || normalized.endsWith(".db") || basename.startsWith(".env") || /(?:credentials|token).*\.json$/.test(basename);
}

export function validateReviewConfig(input, { root } = {}) {
  if (!root) fail("root is required");
  const config = plainObject(input, "root");
  exactKeys(config, TOP_LEVEL_KEYS, "root");
  if (config.schemaVersion !== 1) fail(`schemaVersion must be 1 (received ${config.schemaVersion})`);
  const paths = plainObject(config.paths, "paths");
  exactKeys(paths, PATH_KEYS, "paths");
  const normalizedPaths = Object.fromEntries(PATH_KEYS.map((key) => [key, relativeRepoPath(paths[key], `paths.${key}`, root)]));
  if (new Set(Object.values(normalizedPaths).map((value) => value.toLowerCase())).size !== PATH_KEYS.length) fail("paths must point to distinct files");
  for (const [key, value] of Object.entries(normalizedPaths)) if (key !== "autofixPolicy" && isImmutableTarget(value)) fail(`paths.${key} points at an immutable excluded path: ${value}`);
  const findingsDir = path.posix.dirname(normalizedPaths.findings);
  const evidencePrefix = findingsDir === "." ? "evidence/" : `${findingsDir}/evidence/`;
  for (const [key, value] of Object.entries(normalizedPaths)) if (value.startsWith(evidencePrefix)) fail(`paths.${key} points inside generated evidence: ${value}`);
  const vocabulary = plainObject(config.vocabulary, "vocabulary");
  exactKeys(vocabulary, VOCABULARY_KEYS, "vocabulary");
  if (typeof vocabulary.findingIdPrefix !== "string" || !/^[A-Z][A-Z0-9]{0,11}$/.test(vocabulary.findingIdPrefix)) fail("vocabulary.findingIdPrefix must be 1-12 uppercase letters or digits, starting with a letter");
  const limits = plainObject(config.limits, "limits");
  exactKeys(limits, LIMIT_KEYS, "limits");
  const normalizedLimits = {};
  for (const key of LIMIT_KEYS) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1) fail(`limits.${key} must be a positive integer`);
    normalizedLimits[key] = limits[key];
  }
  return {
    schemaVersion: 1,
    paths: normalizedPaths,
    vocabulary: {
      findingIdPrefix: vocabulary.findingIdPrefix,
      categories: stringList(vocabulary.categories, "vocabulary.categories"),
      components: stringList(vocabulary.components, "vocabulary.components"),
      areas: stringList(vocabulary.areas, "vocabulary.areas")
    },
    limits: normalizedLimits,
    verification: stringList(config.verification, "verification")
  };
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
async function nearestExistingAncestor(target, root) {
  let current = target;
  while (isInsideRoot(root, current)) {
    try { return await fs.realpath(current); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current === root) break;
    current = path.dirname(current);
  }
  return null;
}
async function assertConfiguredPathsStayInsideRoot(config, root) {
  const rootReal = await fs.realpath(root);
  for (const [key, value] of Object.entries(config.paths)) {
    const ancestorReal = await nearestExistingAncestor(path.resolve(root, ...value.split("/")), root);
    if (!ancestorReal || !isInsideRoot(rootReal, ancestorReal)) fail(`paths.${key} resolves through a link outside the repository`);
  }
}

export async function loadReviewConfig({ file, root } = {}) {
  if (!file || !root) fail("file and root are required");
  let content;
  try { content = await fs.readFile(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") fail(`missing ${path.relative(root, file) || path.basename(file)}; create the required file before running review commands`);
    throw error;
  }
  try {
    const config = validateReviewConfig(JSON.parse(content), { root });
    await assertConfiguredPathsStayInsideRoot(config, root);
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) fail(`invalid JSON in ${path.relative(root, file) || path.basename(file)}: ${error.message}`);
    throw error;
  }
}

export function resolveReviewPaths(config, root) {
  return Object.fromEntries(Object.entries(config.paths).map(([key, value]) => [key, path.resolve(root, ...value.split("/"))]));
}
