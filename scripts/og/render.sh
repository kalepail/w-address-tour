#!/usr/bin/env bash
# Renders the share card and touch icon into public/ with agent-browser.
#   bash scripts/og/render.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
ab() { perl -e 'alarm shift; exec @ARGV' 60 agent-browser --session og-render "$@"; }

render() { # html width height out
  ab set viewport "$2" "$3" 2 >/dev/null
  ab open "file://$ROOT/scripts/og/$1" >/dev/null
  ab wait 1500 >/dev/null
  ab eval 'document.fonts.ready.then(() => document.fonts.check("16px Geist"))' | grep -q true || { echo "fonts did not load for $1"; exit 1; }
  ab screenshot "$TMP/$4" >/dev/null
  # Downsample the 2x capture for crisp text at the target size.
  sips -z "$3" "$2" "$TMP/$4" --out "$ROOT/public/$4" >/dev/null
  echo "public/$4 $(sips -g pixelWidth -g pixelHeight "$ROOT/public/$4" | awk '/pixel/{printf "%s ", $2}')$(du -h "$ROOT/public/$4" | cut -f1)"
}

render card.html 1200 630 og.png
render icon.html 180 180 apple-touch-icon.png
ab close >/dev/null 2>&1 || true
rm -rf "$TMP"
