$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {

node tests/run.mjs
if ($LASTEXITCODE -ne 0) {
    throw "Node回帰テストに失敗しました"
}

# ZIPの組み立てと契約検査は scripts/package.mjs が正本。verify.sh と同じ手順を呼ぶ。
node scripts/package.mjs build
if ($LASTEXITCODE -ne 0) {
    throw "配布ZIPの作成に失敗しました"
}
node scripts/package.mjs check
if ($LASTEXITCODE -ne 0) {
    throw "配布ZIPの検証に失敗しました"
}

Write-Host "Required verification completed."
} finally {
    Pop-Location
}
