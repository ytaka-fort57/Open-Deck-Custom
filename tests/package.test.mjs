import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PACKAGE_ENTRIES,
  TARGETS,
  buildPackages,
  checkEntries,
  checkPackages,
  collectEntries,
  compareEntries,
  createZip,
  readVersion,
  readZip,
  zipName
} from "../scripts/package.mjs";

const chromium = TARGETS.find((target) => target.name === "chromium");
const firefox = TARGETS.find((target) => target.name === "firefox");

function withOutDir(callback) {
  const outDir = mkdtempSync(join(tmpdir(), "open-deck-package-"));
  return Promise.resolve(callback(outDir)).finally(() => rmSync(outDir, { recursive: true, force: true }));
}

test("配布スクリプトはZIP名・同梱entry・manifest選択を持たず scripts/package.mjs を呼ぶだけ", () => {
  // 判断を4スクリプトへ写すと、片方だけ変えても両方の検証が通る状態へ戻る(BL-045 / BL-047)。
  for (const file of ["package.ps1", "package.sh", "verify.ps1", "verify.sh"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /scripts\/package\.mjs/, `${file} は scripts/package.mjs を呼ぶ`);
    assert.doesNotMatch(source, /Open-Deck_|manifest_firefox|\.zip\b/i, `${file} にZIP名やmanifest選択が残っている`);
    assert.doesNotMatch(source, /about_opd|_locales|settings_codec/, `${file} に同梱entryの列挙が残っている`);
    assert.doesNotMatch(source, /Compress-Archive|\bzip -r|\bunzip\b/, `${file} が外部のZIPツールに依存している`);
  }
  assert.match(readFileSync(".github/workflows/release.yml", "utf8"), /\.\/verify\.sh/);
});

test("ZIP名はターゲットごとに1つの規則で決まり、公開される小文字の名前になる", () => {
  assert.deepEqual(TARGETS.map((target) => zipName(target, "1.1.3.7")), [
    "Open-Deck_chromium_1_1_3_7.zip",
    "Open-Deck_firefox_1_1_3_7.zip"
  ]);
  assert.match(readVersion(), /^\d+(?:\.\d+)*$/);
});

test("ZIPの書き出しと読み取りは名前・内容・CRCを往復で保つ", () => {
  const entries = [
    { name: "a/圧縮される.txt", data: Buffer.from("x".repeat(2000)) },
    { name: "b.bin", data: Buffer.from([0, 1, 2]) },
    { name: "empty.txt", data: Buffer.alloc(0) }
  ];
  const zip = createZip(entries);
  assert.deepEqual(readZip(zip).map(({ name, data }) => [name, data.toString("hex")]), entries.map(({ name, data }) => [name, data.toString("hex")]));

  const corrupted = Buffer.from(zip);
  corrupted[corrupted.indexOf("b.bin") + 5] ^= 0xff;
  assert.throws(() => readZip(corrupted), /CRC/);
});

test("同じソースからは同じバイト列のZIPになる", () => {
  assert.equal(createZip(collectEntries(chromium)).equals(createZip(collectEntries(chromium))), true);
});

test("両ターゲットのZIPを作ると、現在のソースと一致し契約を満たす", () => withOutDir(async (outDir) => {
  const results = await buildPackages({ outDir });
  assert.deepEqual(results.map((result) => result.target), ["chromium", "firefox"]);
  const checked = await checkPackages({ outDir });
  assert.deepEqual(checked.map((result) => result.entries), results.map((result) => result.entries));

  const version = readVersion();
  const chromiumEntries = readZip(readFileSync(join(outDir, zipName(chromium, version))));
  const firefoxEntries = readZip(readFileSync(join(outDir, zipName(firefox, version))));
  assert.deepEqual(chromiumEntries.map((entry) => entry.name), firefoxEntries.map((entry) => entry.name));
  const manifestOf = (entries) => JSON.parse(entries.find((entry) => entry.name === "manifest.json").data.toString("utf8"));
  assert.equal(manifestOf(chromiumEntries).manifest_version, 3);
  assert.equal(manifestOf(firefoxEntries).manifest_version, 2);
  for (const entries of [chromiumEntries, firefoxEntries]) {
    assert.equal(entries.some((entry) => entry.name === "manifest_firefox.json"), false);
    for (const root of PACKAGE_ENTRIES) assert.equal(entries.some((entry) => entry.name.split("/")[0] === root), true, `${root} が同梱されている`);
  }
}));

test("既存ZIPへ再梱包しても、前回だけにあったentryは残らない", () => withOutDir(async (outDir) => {
  // 旧 package.sh は zip -r で既存ZIPを更新していたため、削除・改名したファイルが残った(BL-044)。
  const version = readVersion();
  for (const target of TARGETS) {
    const stale = [...collectEntries(target), { name: "extensions/removed_helper.js", data: Buffer.from("old") }, { name: "icon/old.png", data: Buffer.from("old") }];
    writeFileSync(join(outDir, zipName(target, version)), createZip(stale));
  }
  await assert.rejects(checkPackages({ outDir }), /余剰: extensions\/removed_helper\.js/);

  await buildPackages({ outDir });
  for (const target of TARGETS) {
    const names = readZip(readFileSync(join(outDir, zipName(target, version)))).map((entry) => entry.name);
    assert.equal(names.includes("extensions/removed_helper.js"), false);
    assert.equal(names.includes("icon/old.png"), false);
  }
  await checkPackages({ outDir });
}));

test("manifestが入れ替わっていないZIPは検証に失敗する", () => withOutDir(async (outDir) => {
  // Firefox版へChromium用manifestが入ったまま検証を通過していた(BL-046)。
  assert.deepEqual(checkEntries(chromium, collectEntries(chromium)), []);
  assert.deepEqual(checkEntries(firefox, collectEntries(firefox)), []);

  const firefoxErrors = checkEntries(firefox, collectEntries(chromium));
  assert.ok(firefoxErrors.some((error) => /manifest_version が 2/.test(error)), firefoxErrors.join("\n"));
  assert.ok(firefoxErrors.some((error) => /browser_specific_settings がありません/.test(error)));
  assert.ok(firefoxErrors.some((error) => /別ターゲットの action/.test(error)));
  const chromiumErrors = checkEntries(chromium, collectEntries(firefox));
  assert.ok(chromiumErrors.some((error) => /manifest_version が 3/.test(error)), chromiumErrors.join("\n"));
  assert.ok(chromiumErrors.some((error) => /host_permissions がありません/.test(error)));

  const version = readVersion();
  await buildPackages({ outDir });
  writeFileSync(join(outDir, zipName(firefox, version)), createZip(collectEntries(chromium)));
  await assert.rejects(checkPackages({ outDir }), /Open-Deck_firefox_.*契約を満たしません[\s\S]*manifest_version/);
}));

test("許可リスト外・必須ファイル欠落・manifest重複を契約違反として返す", () => {
  const base = collectEntries(chromium);
  assert.ok(checkEntries(chromium, [...base, { name: "docs/notes.md", data: Buffer.from("") }]).some((error) => /許可リスト外の項目があります: docs\/notes\.md/.test(error)));
  assert.ok(checkEntries(chromium, [...base, { name: "manifest_firefox.json", data: Buffer.from("{}") }]).some((error) => /許可リスト外/.test(error)));
  assert.ok(checkEntries(chromium, base.filter((entry) => entry.name !== "extensions/custom/safe_values.js")).some((error) => /必須ファイルがありません: extensions\/custom\/safe_values\.js/.test(error)));
  assert.ok(checkEntries(chromium, [...base, base.find((entry) => entry.name === "manifest.json")]).some((error) => /manifest\.json の数が不正です: 2/.test(error)));
  assert.deepEqual(compareEntries(base, base.filter((entry) => entry.name !== "content.js")), ["欠落: content.js"]);
});

test("Chromium版は動作に必要な最小バージョンを宣言する", () => {
  const base = collectEntries(chromium);
  const manifestEntry = base.find((entry) => entry.name === "manifest.json");
  const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  //DNR の requestDomains / initiatorDomains は 101、文章校正の CSS :has は 105 以降
  assert.ok(Number(manifest.minimum_chrome_version) >= 105);
  delete manifest.minimum_chrome_version;
  const without = base.map((entry) => entry === manifestEntry ? { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) } : entry);
  assert.ok(checkEntries(chromium, without).includes("manifest.json に minimum_chrome_version がありません"));
});
