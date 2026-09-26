#!/bin/zsh
# usage (from the repo root): tests/sync-fuzz/fuzz/shrinkshow.sh CLASS seed...
# Shrinks each seed on this checkout (or FUZZ_ROOT) and prints the minimal trace.
CONFIG=tests/sync-fuzz/vitest.config.js
OUT=tests/sync-fuzz/out
mkdir -p $OUT
cls=$1; shift
for s in "$@"; do
  FUZZ_SEED=$s FUZZ_CLASS=$cls FUZZ_LEN=${FUZZ_LEN:-40} npx vitest run --config $CONFIG fuzz/shrink.test.js >/dev/null 2>&1 || { echo "seed $s: shrink failed"; continue; }
  FUZZ_SEED=$s FUZZ_ACTIONS=$OUT/min-$s.json FUZZ_OUT=$OUT/replay-$s.txt npx vitest run --config $CONFIG fuzz/replay.test.js >/dev/null 2>&1
  echo "=================== seed $s ($cls)"
  sed -n '/--- trace/,/--- server log/p' $OUT/replay-$s.txt | grep -v "GET /api/categories\|GET /api/board\|processed at send: 200)$" | grep -v '^--- server log' | cut -c1-400 | head -${FUZZ_LINES:-45}
done
