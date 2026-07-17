$ErrorActionPreference = "Stop"

# 設定
$TargetDir = "."
$TmpDir = Join-Path $TargetDir "package_tmp"
$OutputDir = Join-Path $TargetDir "package"

# バージョン取得
function Get-Version {
    $manifestPath = $null
    if (Test-Path (Join-Path $TargetDir "manifest.json")) {
        $manifestPath = Join-Path $TargetDir "manifest.json"
    } elseif (Test-Path (Join-Path $TargetDir "manifest_firefox.json")) {
        $manifestPath = Join-Path $TargetDir "manifest_firefox.json"
    } else {
        return "0_0_0"
    }

    $json = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if (-not $json.version) { return "0_0_0" }
    return ($json.version.ToString() -replace '\.', '_')
}

$Version = Get-Version
Write-Host "version: $Version"

$ZipFirefox = "Open-Deck_Firefox_${Version}.zip"
$ZipChrome  = "Open-Deck_Chromium_${Version}.zip"

# 配布に必要な項目だけを列挙する。開発用ファイルは追加されてもZIPへ入らない。
$PackageEntries = @(
    "_locales",
    "extensions",
    "icon",
    "about_opd.html",
    "about_opd.js",
    "background.js",
    "content.js",
    "icon.png",
    "LICENSE",
    "manifest.json",
    "manifest_firefox.json",
    "popup.html",
    "popup.js",
    "profile_debug.html",
    "profile_debug.js",
    "text_review_privacy_policy.md"
)

# 初期化
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Remove-Item -Recurse -Force -ErrorAction Ignore $TmpDir
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

function Copy-PackageEntries {
    param(
        [Parameter(Mandatory=$true)][string]$Dest,
        [Parameter(Mandatory=$true)][bool]$IncludeFirefoxManifest
    )

    foreach ($Entry in $PackageEntries) {
        if (-not $IncludeFirefoxManifest -and $Entry -eq "manifest_firefox.json") {
            continue
        }
        $SourcePath = Join-Path $TargetDir $Entry
        if (-not (Test-Path -LiteralPath $SourcePath)) {
            throw "配布対象が見つかりません: $SourcePath"
        }
        Copy-Item -LiteralPath $SourcePath -Destination $Dest -Recurse -Force
    }
}

# Firefox 用 ZIP 作成
Copy-PackageEntries -Dest $TmpDir -IncludeFirefoxManifest $true

$ffManifest = Join-Path $TmpDir "manifest_firefox.json"
$mainManifest = Join-Path $TmpDir "manifest.json"
if (Test-Path $ffManifest) {
    Move-Item $ffManifest $mainManifest -Force
}

$ffZipPath = Join-Path $OutputDir $ZipFirefox
if (Test-Path $ffZipPath) { Remove-Item -Force $ffZipPath }
Compress-Archive -Path (Join-Path $TmpDir "*") -DestinationPath $ffZipPath -Force

Remove-Item -Recurse -Force $TmpDir
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# Chrome 用 ZIP 作成
Copy-PackageEntries -Dest $TmpDir -IncludeFirefoxManifest $false

$chZipPath = Join-Path $OutputDir $ZipChrome
if (Test-Path $chZipPath) { Remove-Item -Force $chZipPath }
Compress-Archive -Path (Join-Path $TmpDir "*") -DestinationPath $chZipPath -Force

Remove-Item -Recurse -Force $TmpDir

Write-Host "ZIP圧縮が完了しました:"
Write-Host " - Firefox版: $ffZipPath"
Write-Host " - Chrome版:  $chZipPath"
