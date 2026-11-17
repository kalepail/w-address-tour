#!/usr/bin/env bash
# Clicks through the whole tour in a real Chrome (agent-browser) against the
# live testnet. Saves a full-page screenshot per step.
#   bash scripts/browser-tour.sh [url] [width] [height] [light|dark] [outdir]
set -euo pipefail
URL="${1:-http://localhost:5299/}"
W="${2:-1440}"
H="${3:-900}"
SCHEME="${4:-light}"
OUT="${5:-.design/flow}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"  # agent-browser needs absolute paths
SESSION="wtour-${W}-${SCHEME}"
# Each command gets a 60 s limit so a stuck browser fails fast.
ab() { perl -e 'alarm shift; exec @ARGV' 60 agent-browser --session "$SESSION" "$@"; }

ab close >/dev/null 2>&1 || true
ab set viewport "$W" "$H" "${SCALE:-1}" >/dev/null
ab set media "$SCHEME" >/dev/null
ab open "$URL" >/dev/null
ab wait 1000 >/dev/null
ab screenshot --full "$OUT/0-${W}-${SCHEME}.png" >/dev/null

STATE='(document.getElementById("next").disabled ? "busy" : document.querySelector(".error-box") ? "error" : "ready") + " | " + document.querySelector(".eyebrow")?.textContent + " | next: " + document.getElementById("next").textContent.trim()'
start=$(date +%s)
for i in 1 2 3 4 5 6 7 8 9; do
  ab click '#next' >/dev/null
  sleep 0.5
  st=""
  for k in $(seq 1 90); do
    st=$(ab eval "$STATE" 2>/dev/null | tail -1)
    if [[ "$st" == '"ready'* || "$st" == '"error'* ]]; then break; fi
    sleep 1
  done
  echo "step $i: $st (${k}s)"
  ab wait 300 >/dev/null
  ab screenshot --full "$OUT/${i}-${W}-${SCHEME}.png" >/dev/null
  if [[ $i -eq 9 && "$st" != *"Step 1 · The wallet"* ]]; then echo "ERROR: restart did not return to step 1"; exit 1; fi
  if [[ "$st" == '"error'* ]]; then
    echo "ERROR at step $i:"
    ab eval 'document.querySelector(".error-box").innerText'
    exit 1
  fi
done
echo "total $(( $(date +%s) - start ))s"
echo "--- ledger"
ab eval 'document.getElementById("ledger").innerText'
echo "--- page errors"
ab errors || true
echo "--- console errors"
ab console 2>&1 | grep -iE 'error|\[tour\]' || echo "none"
