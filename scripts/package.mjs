// 配布ZIPの組み立てと検証の正本。
// ZIP名・同梱entry・ターゲットごとのmanifest・ZIP書き出しをここだけに置き、
// package.ps1 / package.sh / verify.ps1 / verify.sh はこのスクリプトを呼ぶだけにする。
// ZIPは zlib で自前に書き出す。外部の zip コマンドや Compress-Archive に依存すると、
// OSごとに成果物の名前・entry構成・既存ZIPの扱いがずれるため(BL-044 / BL-045 / BL-047)。
import { promises as fs, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "package");

// 配布に必要な項目だけを列挙する。開発用ファイルは追加されてもZIPへ入らない。
// manifest はターゲットごとに manifest.json として書き込むので、ここには含めない。
export const PACKAGE_ENTRIES = [
  "_locales",
  "extensions",
  "icon",
  "about_opd.html",
  "about_opd.js",
  "background.js",
  "content.js",
  "deck.css",
  "icon.png",
  "LICENSE",
  "popup.html",
  "popup.js",
  "profile_debug.html",
  "profile_debug.js",
  "text_review_privacy_policy.md"
];

// 読み込みに欠かせず、許可リストのディレクトリ指定だけでは欠落に気づけないファイル。
export const REQUIRED_ENTRIES = [
  "extensions/custom/settings_codec.js",
  "extensions/custom/safe_values.js"
];

// ZIP名の大小文字は GitHub Release に公開される側(旧 package.sh)に合わせる。
export const TARGETS = [
  {
    name: "chromium",
    manifestSource: "manifest.json",
    manifestVersion: 3,
    requiredKeys: ["action", "host_permissions"],
    forbiddenKeys: ["browser_action", "browser_specific_settings"]
  },
  {
    name: "firefox",
    manifestSource: "manifest_firefox.json",
    manifestVersion: 2,
    requiredKeys: ["browser_action", "browser_specific_settings"],
    forbiddenKeys: ["action"]
  }
];

// 同じソースからは同じバイト列のZIPになるよう、entryの時刻を固定する(2000-01-01 00:00)。
const DOS_TIME = 0;
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
const UTF8_FLAG = 0x0800;

function fail(message) {
  throw new Error(message);
}

export function readVersion(root = REPO_ROOT) {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+)*$/.test(manifest.version)) {
    fail(`manifest.json の version が不正です: ${manifest.version}`);
  }
  return manifest.version;
}

export function zipName(target, version) {
  return `Open-Deck_${target.name}_${version.replaceAll(".", "_")}.zip`;
}

function listFiles(root, relative) {
  const absolute = path.join(root, relative);
  let stat;
  try {
    stat = statSync(absolute);
  } catch (error) {
    if (error.code === "ENOENT") fail(`配布対象が見つかりません: ${relative}`);
    throw error;
  }
  if (!stat.isDirectory()) return [relative];
  return readdirSync(absolute)
    .sort()
    .flatMap((name) => listFiles(root, `${relative}/${name}`));
}

// ターゲットのZIPに入るべき entry を、名前順に { name, data } で返す。
export function collectEntries(target, root = REPO_ROOT) {
  const entries = PACKAGE_ENTRIES.flatMap((entry) => listFiles(root, entry))
    .map((name) => ({ name, data: readFileSync(path.join(root, name)) }));
  entries.push({ name: "manifest.json", data: readFileSync(path.join(root, target.manifestSource)) });
  return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    // 圧縮で大きくなる小さなファイルは無圧縮で格納する。
    const [method, stored] = deflated.length < data.length ? [8, deflated] : [0, data];
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + stored.length;
  }
  const centralSize = centrals.reduce((size, buffer) => size + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// 検証用の最小のZIP読み取り。central directory から entry を引き、中身とCRCを確かめる。
// ディレクトリentry(名前が / で終わる)は Compress-Archive などが作るが、配布物の内容ではないので返さない。
export function readZip(buffer) {
  let endOffset = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 0xffff); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) fail("ZIPの終端レコードが見つかりません");
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail("ZIPの central directory が壊れています");
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength).replaceAll("\\", "/");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail(`${name} のローカルヘッダーが壊れています`);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const stored = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(stored);
    else if (method === 8) data = inflateRawSync(stored);
    else fail(`${name} の圧縮方式に対応していません: ${method}`);
    if (crc32(data) !== checksum) fail(`${name} のCRCが一致しません`);
    entries.push({ name, data });
  }
  return entries;
}

// ZIPの中身がターゲットの契約を満たすかを検査し、違反を配列で返す。
export function checkEntries(target, entries) {
  const errors = [];
  const names = entries.map((entry) => entry.name);
  const allowedRoots = new Set([...PACKAGE_ENTRIES, "manifest.json"]);

  const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicated.length) errors.push(`同じ名前のentryが重複しています: ${[...new Set(duplicated)].join(", ")}`);
  for (const name of names) {
    if (!allowedRoots.has(name.split("/")[0])) errors.push(`許可リスト外の項目があります: ${name}`);
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!names.includes(required)) errors.push(`必須ファイルがありません: ${required}`);
  }

  const manifests = entries.filter((entry) => entry.name === "manifest.json");
  if (manifests.length !== 1) {
    errors.push(`manifest.json の数が不正です: ${manifests.length}`);
    return errors;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifests[0].data.toString("utf8").replace(/^﻿/, ""));
  } catch (error) {
    errors.push(`manifest.json を読めません: ${error.message}`);
    return errors;
  }
  if (manifest.manifest_version !== target.manifestVersion) {
    errors.push(`manifest_version が ${target.manifestVersion} ではありません: ${manifest.manifest_version}`);
  }
  for (const key of target.requiredKeys) {
    if (!(key in manifest)) errors.push(`manifest.json に ${key} がありません`);
  }
  for (const key of target.forbiddenKeys) {
    if (key in manifest) errors.push(`manifest.json に別ターゲットの ${key} があります`);
  }
  return errors;
}

// ZIPの中身が現在のソースから組み立てた内容と entry 単位で一致するかを確かめる。
// 前回のZIPにだけ残ったentry(余剰)や、入れ替え忘れたmanifest(内容差)をここで検出する。
export function compareEntries(expected, actual) {
  const errors = [];
  const actualByName = new Map(actual.map((entry) => [entry.name, entry.data]));
  const expectedNames = new Set(expected.map((entry) => entry.name));
  for (const { name, data } of expected) {
    if (!actualByName.has(name)) errors.push(`欠落: ${name}`);
    else if (!actualByName.get(name).equals(data)) errors.push(`内容差: ${name}`);
  }
  for (const name of actualByName.keys()) {
    if (!expectedNames.has(name)) errors.push(`余剰: ${name}`);
  }
  return errors;
}

function assertNoErrors(label, errors) {
  if (errors.length) fail(`${label}\n${errors.map((error) => `  - ${error}`).join("\n")}`);
}

export async function buildPackages({ root = REPO_ROOT, outDir = DEFAULT_OUT_DIR } = {}) {
  const version = readVersion(root);
  await fs.mkdir(outDir, { recursive: true });
  const results = [];
  for (const target of TARGETS) {
    const entries = collectEntries(target, root);
    assertNoErrors(`${target.name} の配布内容が契約を満たしません`, checkEntries(target, entries));
    const file = path.join(outDir, zipName(target, version));
    // 既存ZIPを更新せず、一時ファイルへ新規に書いてから置き換える。前回のentryは残らない。
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, createZip(entries));
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    results.push({ target: target.name, file, entries: entries.length });
  }
  return results;
}

export async function checkPackages({ root = REPO_ROOT, outDir = DEFAULT_OUT_DIR } = {}) {
  const version = readVersion(root);
  const results = [];
  for (const target of TARGETS) {
    const file = path.join(outDir, zipName(target, version));
    let buffer;
    try {
      buffer = await fs.readFile(file);
    } catch (error) {
      if (error.code === "ENOENT") fail(`ZIPが見つかりません: ${path.relative(root, file)}`);
      throw error;
    }
    const actual = readZip(buffer);
    const label = path.basename(file);
    assertNoErrors(`${label} が契約を満たしません`, checkEntries(target, actual));
    assertNoErrors(`${label} が現在のソースと一致しません`, compareEntries(collectEntries(target, root), actual));
    results.push({ target: target.name, file, entries: actual.length });
  }
  return results;
}

function parseOutDir(argv) {
  const index = argv.indexOf("--out");
  if (index < 0) return DEFAULT_OUT_DIR;
  if (!argv[index + 1]) fail("--out にはディレクトリを指定します");
  return path.resolve(process.cwd(), argv[index + 1]);
}

export async function main(argv = process.argv.slice(2)) {
  const [command = "build", ...rest] = argv;
  const outDir = parseOutDir(rest);
  if (command === "build") {
    console.log(`version: ${readVersion()}`);
    for (const { target, file, entries } of await buildPackages({ outDir })) {
      console.log(` - ${target}: ${path.relative(process.cwd(), file)} (${entries} entries)`);
    }
    return;
  }
  if (command === "check") {
    for (const { file, entries } of await checkPackages({ outDir })) {
      console.log(`${path.basename(file)} : OK (${entries} entries)`);
    }
    return;
  }
  fail(`unknown command: ${command} (build | check)`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`package: ${error.message}`);
    process.exitCode = 1;
  });
}
