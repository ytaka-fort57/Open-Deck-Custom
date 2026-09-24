import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

//拡張の周期や期間は content script の中にあり、E2E からは参照できない。
//待ち時間を手で写すと実装の変更に追従しないため、ソースの宣言から読み取る。
//同名の宣言が複数あるとどれを指すか決まらないので、1つだけであることを求める。
export function implementationConstant(file, name) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    const matches = [...source.matchAll(new RegExp(String.raw`\bconst ${name} = (\d+);`, "g"))];
    if (matches.length !== 1) {
        throw new Error(`${file}: const ${name} の宣言が ${matches.length} 件あります`);
    }
    return Number(matches[0][1]);
}
