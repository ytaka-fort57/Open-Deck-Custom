#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

for command_name in node zip unzip; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "必要なコマンドが見つかりません: $command_name" >&2
        exit 1
    fi
done

node tests/run.mjs
./package.sh

VERSION="$(grep -oE '"version"\s*:\s*"[^"]+"' manifest.json | sed -E 's/.*"([^"]+)"/\1/' | tr '.' '_')"
ZIP_FILES=(
  "package/Open-Deck_chromium_${VERSION}.zip"
  "package/Open-Deck_firefox_${VERSION}.zip"
)

for zip_file in "${ZIP_FILES[@]}"; do
    if [ ! -f "$zip_file" ]; then
        echo "ZIPが見つかりません: $zip_file" >&2
        exit 1
    fi
    entries="$(unzip -Z1 "$zip_file")"
    while IFS= read -r entry; do
        root="${entry%%/*}"
        case "$root" in
          _locales|extensions|icon|about_opd.html|about_opd.js|background.js|content.js|icon.png|LICENSE|manifest.json|popup.html|popup.js|profile_debug.html|profile_debug.js|text_review_privacy_policy.md) ;;
          "") ;;
          *) echo "$zip_file に許可リスト外の項目があります: $entry" >&2; exit 1 ;;
        esac
    done <<< "$entries"
    if [ "$(grep -c '^manifest.json$' <<< "$entries")" -ne 1 ]; then
        echo "$zip_file のmanifest.json数が不正です" >&2
        exit 1
    fi
    if grep -q '^manifest_firefox.json$' <<< "$entries"; then
        echo "$zip_file に置換前のFirefox manifestが残っています" >&2
        exit 1
    fi
    grep -q '^extensions/custom/settings_codec.js$' <<< "$entries"
    grep -q '^extensions/custom/safe_values.js$' <<< "$entries"
    echo "$zip_file : OK ($(wc -l <<< "$entries") entries)"
done

echo "Required verification completed."
