import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateReviewConfig } from "../scripts/review-config-core.mjs";
import { REVIEW_CONFIG } from "../scripts/review-config.mjs";
import { readLenses } from "../scripts/review-lenses.mjs";
import { getCheck } from "../scripts/review-checks.mjs";
import { readPolicy, validatePolicy } from "../scripts/review-autofix.mjs";

test("review config uses the existing Open-Deck backlog contract", () => {
  const config = validateReviewConfig(REVIEW_CONFIG, { root: process.cwd() });
  assert.equal(config.vocabulary.findingIdPrefix, "BL");
  assert.equal(config.paths.findings, "docs/backlog/findings.jsonl");
  assert.equal(config.paths.report, "docs/backlog/report.md");
  assert.deepEqual(config.verification, [
    "npm run test:unit",
    "npm run backlog:validate -- --report"
  ]);
});

test("the stage-5 pilot has the minimum portable lens set", async () => {
  const lenses = await readLenses();
  assert.ok(lenses.some((lens) => lens.check === "docs-links"));
  assert.ok(lenses.some((lens) => lens.check === "hardcoded-path"));
  assert.ok(lenses.some((lens) => lens.id === "LENS-test-quality"));
  assert.ok(lenses.some((lens) => lens.id === "LENS-docs-drift"));
  assert.ok(lenses.some((lens) => lens.id === "LENS-extension-contract"));
  for (const lens of lenses.filter((entry) => entry.mode === "deterministic")) {
    assert.equal(getCheck(lens.check).id, lens.check);
  }
});

test("autofix pilot is limited to docs links on custom", async () => {
  const policy = validatePolicy(await readPolicy());
  assert.equal(policy.baseBranch, "custom");
  assert.deepEqual(Object.keys(policy.classes), ["docs-link"]);
  assert.ok(policy.forbiddenPaths.includes("manifest.json"));
  assert.ok(policy.forbiddenPaths.includes(".github/**"));
  assert.ok(policy.forbiddenPaths.includes(".agents/skills/review-*/**"));
  assert.ok(policy.forbiddenPaths.includes("docs/dev/automated-review-cycle-runbook.md"));
});

test("Codex and Claude adapters share one CLI contract", async () => {
  for (const skill of ["review-cycle", "review-autofix"]) {
    const codex = await readFile(`.agents/skills/${skill}/SKILL.md`, "utf8");
    const claude = await readFile(`.claude/skills/${skill}/SKILL.md`, "utf8");
    assert.equal(claude.trimEnd(), codex.trimEnd());
  }
});
