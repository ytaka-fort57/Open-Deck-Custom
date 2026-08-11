$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {

node tests/run.mjs
if ($LASTEXITCODE -ne 0) {
    throw "Node回帰テストに失敗しました"
}

& "$PSScriptRoot\package.ps1"

$Manifest = Get-Content (Join-Path $PSScriptRoot "manifest.json") -Raw | ConvertFrom-Json
$Version = $Manifest.version.ToString() -replace '\.', '_'
$ExpectedZips = @(
    "Open-Deck_Chromium_${Version}.zip",
    "Open-Deck_Firefox_${Version}.zip"
)
$AllowedRoots = @(
    "_locales", "extensions", "icon",
    "about_opd.html", "about_opd.js", "background.js", "content.js",
    "icon.png", "LICENSE", "manifest.json", "popup.html", "popup.js",
    "profile_debug.html", "profile_debug.js", "text_review_privacy_policy.md"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($ZipName in $ExpectedZips) {
    $ZipPath = Join-Path $PSScriptRoot "package\$ZipName"
    if (-not (Test-Path -LiteralPath $ZipPath)) {
        throw "ZIPが見つかりません: $ZipPath"
    }
    $Zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $Entries = @($Zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        foreach ($Entry in $Entries) {
            $Root = ($Entry -split '/')[0]
            if ($Root -and $Root -notin $AllowedRoots) {
                throw "$ZipName に許可リスト外の項目があります: $Entry"
            }
        }
        if (@($Entries | Where-Object { $_ -eq "manifest.json" }).Count -ne 1) {
            throw "$ZipName のmanifest.json数が不正です"
        }
        if ($Entries -contains "manifest_firefox.json") {
            throw "$ZipName に置換前のFirefox manifestが残っています"
        }
        if ($Entries -notcontains "extensions/custom/settings_codec.js") {
            throw "$ZipName にカスタム設定codecがありません"
        }
        if ($Entries -notcontains "extensions/custom/safe_values.js") {
            throw "$ZipName に安全な値境界helperがありません"
        }
        Write-Host "$ZipName : OK ($($Entries.Count) entries)"
    } finally {
        $Zip.Dispose()
    }
}

Write-Host "Required verification completed."
} finally {
    Pop-Location
}
