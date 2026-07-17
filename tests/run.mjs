import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testDir = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(testDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join(testDir, name));

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    cwd: join(testDir, ".."),
    stdio: "inherit"
});

process.exit(result.status ?? 1);
