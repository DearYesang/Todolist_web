#!/bin/zsh
# usage (from the repo root): FUZZ_MAIN_ROOT=<other checkout> tests/sync-fuzz/fuzz/shrinkcmp.sh CLASS seed...
# Shrinks each seed on this checkout, then replays the minimal action list on
# this checkout and on FUZZ_MAIN_ROOT, and prints the trace.
MAIN=${FUZZ_MAIN_ROOT:?set FUZZ_MAIN_ROOT to the checkout to compare with}
CONFIG=tests/sync-fuzz/vitest.config.js
OUT=tests/sync-fuzz/out
mkdir -p $OUT
cls=$1; shift
for s in "$@"; do
  FUZZ_SEED=$s FUZZ_CLASS=$cls npx vitest run --config $CONFIG fuzz/shrink.test.js >/dev/null 2>&1 || { echo "seed $s: shrink failed"; continue; }
  FUZZ_SEED=$s FUZZ_ACTIONS=$OUT/min-$s.json FUZZ_OUT=$OUT/replay-$s.txt npx vitest run --config $CONFIG fuzz/replay.test.js >/dev/null 2>&1
  FUZZ_SEED=$s FUZZ_ACTIONS=$OUT/min-$s.json FUZZ_ROOT=$MAIN FUZZ_OUT=$OUT/replay-main-$s.txt npx vitest run --config $CONFIG fuzz/replay.test.js >/dev/null 2>&1
  onmain=$(grep -c "\"inv\":\"${cls%%:*}\",\"kind\":\"${cls#*:}\"" $OUT/replay-main-$s.txt)
  echo "=================== seed $s ($cls) main-has-class=$onmain  $(head -1 $OUT/replay-main-$s.txt)"
  sed -n '/--- trace/,/--- server log/p' $OUT/replay-$s.txt | grep -v "GET /api/categories\|GET /api/board\|processed at send: 200)$" | grep -v '^--- server log' | cut -c1-330 | head -${FUZZ_LINES:-45}
done
