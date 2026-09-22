#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "必要なコマンドが見つかりません: node" >&2
    exit 1
fi

node tests/run.mjs
# ZIPの組み立てと契約検査は scripts/package.mjs が正本。verify.ps1 と同じ手順を呼ぶ。
node scripts/package.mjs build
node scripts/package.mjs check

echo "Required verification completed."
