//ブロック内でconst/letに代入した関数を、そのブロックの外から呼んでいないか検査する。
//`Uncaught ReferenceError: xxx is not defined` の再発防止用で、依存パッケージなしで動かす。

//文字列・テンプレート・正規表現・コメントの中身を空白に潰す(位置と行数は保つ)
export function mask_source(source) {
    const out = source.split("");
    const blank = (start, end) => {
        for (let i = start; i < end && i < out.length; i += 1) {
            if (out[i] !== "\n") out[i] = " ";
        }
    };
    let i = 0;
    let prev_meaningful = "";
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === "/" && next === "/") {
            let end = source.indexOf("\n", i);
            if (end === -1) end = source.length;
            blank(i, end);
            i = end;
            continue;
        }
        if (ch === "/" && next === "*") {
            let end = source.indexOf("*/", i + 2);
            end = end === -1 ? source.length : end + 2;
            blank(i, end);
            i = end;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            let j = i + 1;
            let depth = 0;
            while (j < source.length) {
                const c = source[j];
                if (c === "\\") { j += 2; continue; }
                if (ch === "`" && c === "$" && source[j + 1] === "{") { depth += 1; j += 2; continue; }
                if (ch === "`" && c === "}" && depth > 0) { depth -= 1; j += 1; continue; }
                if (c === ch && depth === 0) break;
                if (ch !== "`" && c === "\n") break;
                j += 1;
            }
            blank(i + 1, j);
            i = j + 1;
            prev_meaningful = ch;
            continue;
        }
        if (ch === "/" && /[=(,:[!&|?{};+\-*%~^]|^$/.test(prev_meaningful)) {
            //正規表現リテラル
            let j = i + 1;
            let in_class = false;
            while (j < source.length) {
                const c = source[j];
                if (c === "\\") { j += 2; continue; }
                if (c === "[") in_class = true;
                else if (c === "]") in_class = false;
                else if (c === "/" && !in_class) break;
                else if (c === "\n") { j = -1; break; }
                j += 1;
            }
            if (j > 0) {
                blank(i + 1, j);
                i = j + 1;
                prev_meaningful = "/";
                continue;
            }
        }
        if (!/\s/.test(ch)) prev_meaningful = ch;
        i += 1;
    }
    return out.join("");
}

//`{`と`}`の対応を取り、位置ごとの最も内側のブロック範囲を引けるようにする
function block_ranges(masked) {
    const ranges = [];
    const stack = [];
    for (let i = 0; i < masked.length; i += 1) {
        if (masked[i] === "{") stack.push(i);
        else if (masked[i] === "}") {
            const start = stack.pop();
            if (start != null) ranges.push({ start, end: i });
        }
    }
    return ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start));
}

function innermost_block(ranges, index) {
    let found = null;
    for (const range of ranges) {
        if (range.start < index && index < range.end) found = range;
    }
    return found;
}

function line_of(source, index) {
    return source.slice(0, index).split("\n").length;
}

const declaration_pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;

//引数名・catch束縛名・for束縛名を集める(同名のブロック外呼び出しを誤検出しないため)
function collect_parameter_names(masked) {
    const names = new Set();
    const add_list = (list) => {
        for (const part of list.split(",")) {
            const name = part.trim().replace(/^\.{3}/, "").split(/[=:\s]/)[0];
            if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
    };
    const patterns = [
        /\bfunction\b\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g,
        /\bfunction\b\s*\(([^()]*)\)/g,
        /\(([^()]*)\)\s*=>/g,
        /\bcatch\s*\(([^()]*)\)/g,
        /\bfor\s*\(\s*(?:const|let|var)\s+([^;)]*)[;)]/g
    ];
    for (const pattern of patterns) {
        for (const match of masked.matchAll(pattern)) add_list(match[1]);
    }
    for (const match of masked.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(match[1]);
    return names;
}

export function find_out_of_scope_calls(source) {
    const masked = mask_source(source);
    const ranges = block_ranges(masked);

    //同名を複数回宣言している場合や引数名と重なる場合はshadowingの判定ができないため対象外にする
    const declarations = new Map();
    const duplicated = collect_parameter_names(masked);
    for (const match of masked.matchAll(declaration_pattern)) {
        const name = match[1];
        if (declarations.has(name)) duplicated.add(name);
        declarations.set(name, match.index + match[0].indexOf(name));
    }

    const findings = [];
    for (const [name, index] of declarations) {
        if (duplicated.has(name)) continue;
        const block = innermost_block(ranges, index);
        if (block == null) continue;
        const usage_pattern = new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`, "g");
        for (const usage of masked.matchAll(usage_pattern)) {
            if (usage.index >= block.start && usage.index <= block.end) continue;
            findings.push({
                name,
                declared_line: line_of(source, index),
                used_line: line_of(source, usage.index)
            });
        }
    }
    return findings;
}
