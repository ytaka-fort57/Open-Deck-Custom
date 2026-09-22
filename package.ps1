$ErrorActionPreference = "Stop"

# 配布ZIPの組み立ては scripts/package.mjs が正本。ここでは呼び出すだけにする。
node (Join-Path $PSScriptRoot "scripts/package.mjs") build
if ($LASTEXITCODE -ne 0) {
    throw "配布ZIPの作成に失敗しました"
}
