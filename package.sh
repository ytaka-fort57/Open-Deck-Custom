#!/bin/bash
set -euo pipefail

# 設定
TARGET_DIR="."
TMP_DIR="./package_tmp"
OUTPUT_DIR="./package"

# バージョン番号を manifest から取得
get_version() {
    local manifest_file=""
    if [ -f "$TARGET_DIR/manifest.json" ]; then
        manifest_file="$TARGET_DIR/manifest.json"
    elif [ -f "$TARGET_DIR/manifest_firefox.json" ]; then
        manifest_file="$TARGET_DIR/manifest_firefox.json"
    else
        echo "0.0.0"
        return
    fi

    # バージョン情報を抽出
    grep -oE '"version"\s*:\s*"[^"]+"' "$manifest_file" | sed -E 's/.*"([^"]+)"/\1/' | tr '.' '_' || echo "0_0_0"
}

VERSION="$(get_version)"
echo "version: $VERSION"

ZIP_FIREFOX="Open-Deck_firefox_${VERSION}.zip"
ZIP_CHROME="Open-Deck_chromium_${VERSION}.zip"

# 配布に必要な項目だけを列挙する。開発用ファイルは追加されてもZIPへ入らない。
PACKAGE_ENTRIES=(
  "_locales"
  "extensions"
  "icon"
  "about_opd.html"
  "about_opd.js"
  "background.js"
  "content.js"
  "icon.png"
  "LICENSE"
  "manifest.json"
  "manifest_firefox.json"
  "popup.html"
  "popup.js"
  "profile_debug.html"
  "profile_debug.js"
  "text_review_privacy_policy.md"
)

# 初期化
mkdir -p "$OUTPUT_DIR"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

copy_package_entries() {
    local include_firefox_manifest="$1"
    local entry
    for entry in "${PACKAGE_ENTRIES[@]}"; do
        if [ "$include_firefox_manifest" != "true" ] && [ "$entry" = "manifest_firefox.json" ]; then
            continue
        fi
        if [ ! -e "$TARGET_DIR/$entry" ]; then
            echo "配布対象が見つかりません: $TARGET_DIR/$entry" >&2
            return 1
        fi
        cp -R "$TARGET_DIR/$entry" "$TMP_DIR/"
    done
}

# Firefox 用 ZIP
copy_package_entries true
if [ -f "$TMP_DIR/manifest_firefox.json" ]; then
    mv "$TMP_DIR/manifest_firefox.json" "$TMP_DIR/manifest.json"
fi
(cd "$TMP_DIR" && zip -r "../$OUTPUT_DIR/$ZIP_FIREFOX" .)
rm -rf "$TMP_DIR"

# Chrome 用 ZIP
mkdir -p "$TMP_DIR"
copy_package_entries false
(cd "$TMP_DIR" && zip -r "../$OUTPUT_DIR/$ZIP_CHROME" .)
rm -rf "$TMP_DIR"

echo "ZIP圧縮が完了しました:"
echo " - Firefox版: $OUTPUT_DIR/$ZIP_FIREFOX"
echo " - Chrome版:  $OUTPUT_DIR/$ZIP_CHROME"