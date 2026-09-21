// 通常コマンド向けの設定入口。doctor は副作用なしの core を直接使う。
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  IMMUTABLE_EXCLUDE,
  loadReviewConfig as loadCoreReviewConfig,
  resolveReviewPaths as resolveCoreReviewPaths,
  validateReviewConfig as validateCoreReviewConfig
} from "./review-config-core.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = process.env.REVIEW_REPO_ROOT ? path.resolve(process.env.REVIEW_REPO_ROOT) : path.resolve(SCRIPT_DIR, "..");
export const CONFIG_FILE = process.env.REVIEW_CONFIG_FILE ? path.resolve(process.env.REVIEW_CONFIG_FILE) : path.join(REPO_ROOT, "review.config.json");

export { IMMUTABLE_EXCLUDE };

export function validateReviewConfig(input, { root = REPO_ROOT } = {}) {
  return validateCoreReviewConfig(input, { root });
}

export function loadReviewConfig({ file = CONFIG_FILE, root = REPO_ROOT } = {}) {
  return loadCoreReviewConfig({ file, root });
}

export function resolveReviewPaths(config, root = REPO_ROOT) {
  return resolveCoreReviewPaths(config, root);
}

export function configuredBookkeepingPaths(config) {
  return [config.paths.findings, config.paths.report, config.paths.fixes, config.paths.health];
}

export const REVIEW_CONFIG = await loadReviewConfig();
export const REVIEW_PATHS = resolveReviewPaths(REVIEW_CONFIG);
