import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_VALUES,
  AREA_VALUES,
  canTransition,
  computeFingerprint,
  findByFingerprint,
  isSuppressed,
  isUnverified,
  parseAddInput,
  planAdd,
  renderReport,
  toAsciiJson,
  validateRecords
} from "../scripts/backlog.mjs";

function makeRecord(overrides = {}) {
  return {
    id: "BL-001",
    createdAt: "2026-09-16",
    updatedAt: "2026-09-16",
    category: "architecture",
    app: "custom",
    area: "responsive",
    priority: "P1",
    status: "discovered",
    title: "タイトル",
    finding: "発見内容",
    impact: "利用者影響",
    evidence: [{ type: "code", file: "extensions/custom/index.js", lines: "30-40" }],
    proposal: "提案",
    verificationRequired: "manual",
    verification: [],
    workNotes: [],
    decision: null,
    relatedCommits: [],
    tags: [],
    ...overrides
  };
}

test("初期監査項目は discovered から in-progress へ移行できる", () => {
  assert.equal(canTransition("discovered", "in-progress"), true);
});

test("manual 必須の項目は手動確認が通るまで未確認である", () => {
  const record = {
    verificationRequired: "both",
    verification: [{ method: "code", result: "passed" }]
  };
  assert.equal(isUnverified(record), true);
});

test("異常発生時確認待ちは通常の未確認一覧から除外する", () => {
  const record = {
    status: "monitoring",
    verificationRequired: "manual",
    verification: []
  };
  assert.equal(canTransition("in-progress", "monitoring"), true);
  assert.equal(isUnverified(record), false);
});

test("レポート生成は入力順に依存しない", () => {
  const first = renderReport([
    makeRecord({ id: "BL-002", priority: "P2", title: "BL-002" }),
    makeRecord({ id: "BL-001", priority: "P1", title: "BL-001" })
  ]);
  const second = renderReport([
    makeRecord({ id: "BL-001", priority: "P1", title: "BL-001" }),
    makeRecord({ id: "BL-002", priority: "P2", title: "BL-002" })
  ]);
  assert.equal(first, second);
  assert.match(first, /カテゴリ: architecture 2/);
});

test("app は本リポジトリの構成要素を受け付ける", () => {
  for (const app of ["content", "custom", "helper", "background", "tests", "docs", "config"]) {
    assert.equal(APP_VALUES.includes(app), true);
  }
  assert.doesNotThrow(() => validateRecords([makeRecord({ app: "content" })]));
  assert.throws(() => validateRecords([makeRecord({ app: "ui" })]), /is not a known app/);
});

test("iframe資源やi18nの論点を area に記録できる", () => {
  for (const area of ["lifecycle", "history", "css", "i18n"]) assert.equal(AREA_VALUES.includes(area), true);
});

test("triaged 以降は acceptanceCriteria が要る", () => {
  assert.throws(
    () => validateRecords([makeRecord({ status: "triaged" })]),
    /needs acceptanceCriteria/
  );
  assert.doesNotThrow(
    () => validateRecords([makeRecord({ status: "triaged", acceptanceCriteria: ["受け入れ条件"] })])
  );
});

test("evidence のパスはリポジトリ相対に限る", () => {
  // findings.jsonl は Windows と Linux の両方で検証するため、実行 OS に依らず
  // ドライブレター・UNC・POSIX 絶対パスのすべてを弾く必要がある。
  for (const file of [
    "C:/tmp/styles.css",
    "C:\\tmp\\styles.css",
    "\\\\server\\share\\styles.css",
    "/etc/styles.css"
  ]) {
    assert.throws(
      () => validateRecords([makeRecord({ evidence: [{ type: "code", file }] })]),
      /repository-relative/,
      `${file} must be rejected on every platform`
    );
  }
  assert.throws(
    () => validateRecords([makeRecord({ evidence: [{ type: "code", file: "../content.js" }] })]),
    /must not contain/
  );
  assert.throws(
    () => validateRecords([makeRecord({ evidence: [{ type: "code", file: "./content.js" }] })]),
    /must not contain/
  );
});

test("fingerprint は行番号のずれで変わらない", () => {
  const before = makeRecord({ evidence: [{ type: "code", file: "content.js", lines: "989-1048" }] });
  const after = makeRecord({ id: "BL-002", evidence: [{ type: "code", file: "content.js", lines: "1100-1160" }] });
  assert.equal(computeFingerprint(before), computeFingerprint(after));
});

test("fingerprint は根拠ファイルと対象が変われば変わる", () => {
  const base = makeRecord();
  assert.notEqual(computeFingerprint(base), computeFingerprint(makeRecord({ evidence: [{ type: "code", file: "content.js" }] })));
  assert.notEqual(computeFingerprint(base), computeFingerprint(makeRecord({ app: "content" })));
  assert.notEqual(computeFingerprint(base), computeFingerprint(makeRecord({ title: "別のタイトル" })));
});

test("fingerprint は表記ゆれを吸収する", () => {
  assert.equal(
    computeFingerprint(makeRecord({ title: "ヘッダーが 3 段に折り返す。" })),
    computeFingerprint(makeRecord({ title: "ヘッダーが3段に折り返す" }))
  );
});

test("実質終了と期限内の抑止は再登録しない対象になる", () => {
  assert.equal(isSuppressed(makeRecord({ status: "verified" }), "2026-09-16"), true);
  assert.equal(isSuppressed(makeRecord({ status: "monitoring" }), "2026-09-16"), true);
  assert.equal(isSuppressed(makeRecord({ suppress: { until: "2026-12-01", reason: "様子見" } }), "2026-09-16"), true);
  assert.equal(isSuppressed(makeRecord({ suppress: { until: "2026-09-01", reason: "期限切れ" } }), "2026-09-16"), false);
  assert.equal(isSuppressed(makeRecord(), "2026-09-16"), false);
});

test("同一 fingerprint の既存項目を引ける", () => {
  const records = [makeRecord({ id: "BL-001" }), makeRecord({ id: "BL-002", title: "別件", evidence: [{ type: "code", file: "content.js" }] })];
  assert.equal(findByFingerprint(records, computeFingerprint(records[1])).id, "BL-002");
  assert.equal(findByFingerprint(records, "0".repeat(12)), undefined);
});

test("suppress には期限と理由が要る", () => {
  assert.throws(() => validateRecords([makeRecord({ suppress: { until: "2026-12-01" } })]), /suppress\.reason/);
  assert.throws(() => validateRecords([makeRecord({ suppress: { reason: "理由" } })]), /suppress\.until/);
  assert.doesNotThrow(() => validateRecords([makeRecord({ suppress: { until: "2026-12-01", reason: "理由" } })]));
  assert.doesNotThrow(() => validateRecords([makeRecord({ suppress: null })]));
});

test("抑止中の項目は要対応から外れて抑止中の節に載る", () => {
  const report = renderReport([
    makeRecord({ id: "BL-001", title: "抑止中の件", suppress: { until: "2999-12-31", reason: "様子見" } }),
    makeRecord({ id: "BL-002", title: "通常の件" })
  ]);
  const actionable = report.slice(report.indexOf("## 要対応"), report.indexOf("## 抑止中"));
  assert.equal(actionable.includes("BL-001"), false);
  assert.equal(actionable.includes("BL-002"), true);
  const suppressed = report.slice(report.indexOf("## 抑止中"), report.indexOf("## 全件一覧"));
  assert.equal(suppressed.includes("BL-001"), true);
  assert.equal(suppressed.includes("BL-002"), false);
});

function inputEntry(overrides = {}) {
  return {
    category: "validation",
    app: "tests",
    area: "validation",
    priority: "P3",
    title: "\"引用\" と 'quote' と $変数 を含む題",
    finding: "改行を\n含む長文",
    impact: "影響",
    proposal: "提案",
    evidence: ["scripts/backlog.mjs:1-5", { file: "tests/run.mjs", lines: "1-3" }],
    ...overrides
  };
}

test("JSON 入力はシェルの引用を経由せず CLI と同じ項目を組み立てる", () => {
  const [optionsMap] = parseAddInput(`\uFEFF${JSON.stringify(inputEntry({ verificationRequired: "both", acceptanceCriteria: ["a", "b"], tags: ["t"], sourceDocument: { file: "docs/a.md", section: "R-1" } }))}`);
  const { records, outcome, id } = planAdd([], optionsMap);
  assert.equal(outcome, "added");
  assert.equal(id, "BL-001");
  const [record] = records;
  assert.equal(record.title, "\"引用\" と 'quote' と $変数 を含む題");
  assert.equal(record.finding, "改行を\n含む長文");
  assert.equal(record.verificationRequired, "both");
  assert.deepEqual(record.acceptanceCriteria, ["a", "b"]);
  assert.deepEqual(record.tags, ["t"]);
  assert.deepEqual(record.sourceDocument, { file: "docs/a.md", section: "R-1" });
  assert.deepEqual(record.evidence, [
    { type: "code", file: "scripts/backlog.mjs", lines: "1-5" },
    { type: "code", file: "tests/run.mjs", lines: "1-3" }
  ]);
  assert.doesNotThrow(() => validateRecords(records));
});

test("JSON 入力の複数件は前の件を踏まえて採番と重複判定を行う", () => {
  const entries = parseAddInput(JSON.stringify([
    inputEntry(),
    inputEntry({ title: "まったく別の題", app: "docs", evidence: ["README.md"] })
  ]));
  let records = [makeRecord({ id: "BL-007" })];
  const outcomes = [];
  for (const entry of entries) {
    const result = planAdd(records, entry);
    records = result.records;
    outcomes.push(`${result.id} ${result.outcome}`);
  }
  assert.deepEqual(outcomes, ["BL-008 added", "BL-009 added"]);

  // 同じ内容をもう一度流すと、新規ではなく同じバッチで追加した項目への再検出になる。
  const again = planAdd(records, parseAddInput(JSON.stringify(inputEntry()))[0]);
  assert.equal(again.outcome, "re-detected");
  assert.equal(again.id, "BL-008");
  assert.equal(records.find((record) => record.id === "BL-008").workNotes.length, 0, "planAdd は入力の records を書き換えない");
});

test("JSON 入力は未知のキーと型違いを弾く", () => {
  assert.throws(() => parseAddInput(JSON.stringify(inputEntry({ titel: "typo" }))), /unknown key: titel/);
  assert.throws(() => parseAddInput(JSON.stringify(inputEntry({ priority: 3 }))), /priority must be a string/);
  assert.throws(() => parseAddInput(JSON.stringify(inputEntry({ allowSimilar: "yes" }))), /allowSimilar must be a boolean/);
  assert.throws(() => parseAddInput("[]"), /at least one finding/);
  assert.throws(() => parseAddInput("{"), /invalid add input JSON/);
});

test("show --ascii の出力は ASCII だけで、元の JSON へ戻せる", () => {
  const record = makeRecord({ title: "日本語の題 🚀" });
  const ascii = toAsciiJson(JSON.stringify(record, null, 2));
  assert.match(ascii, /^[\x00-\x7f]*$/);
  assert.deepEqual(JSON.parse(ascii), record);
});

test("正本の findings.jsonl と report.md が整合している", async () => {
  // npm run backlog:validate -- --report と同じ検査を回帰テストに含め、
  // report.md の再生成漏れと不正なレコードを node tests/run.mjs で検出する。
  const { promises: fs } = await import("node:fs");
  const findings = await fs.readFile("docs/backlog/findings.jsonl", "utf8");
  const records = findings.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  validateRecords(records);
  const report = await fs.readFile("docs/backlog/report.md", "utf8");
  assert.equal(report, renderReport(records), "report is stale: run npm run backlog:report");
});
