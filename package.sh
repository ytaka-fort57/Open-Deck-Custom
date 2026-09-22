#!/bin/bash
set -euo pipefail

# 配布ZIPの組み立ては scripts/package.mjs が正本。ここでは呼び出すだけにする。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/scripts/package.mjs" build