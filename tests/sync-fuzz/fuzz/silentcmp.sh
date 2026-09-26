#!/bin/zsh
# usage (from the repo root): FUZZ_MAIN_ROOT=<other checkout> tests/sync-fuzz/fuzz/silentcmp.sh CLASS seed...
# Shrinks each seed on this checkout, replays the minimal list on both
# checkouts and prints one line of violation classes per checkout.
MAIN=${FUZZ_MAIN_ROOT:?set FUZZ_MAIN_ROOT to the checkout to compare with}
CONFIG=tests/sync-fuzz/vitest.config.js
OUT=tests/sync-fuzz/out
mkdir -p $OUT
cls=$1; shift
for s in "$@"; do
  FUZZ_SEED=$s FUZZ_CLASS=$cls npx vitest run --config $CONFIG fuzz/shrink.test.js >/dev/null 2>&1 || { echo "seed $s: shrink failed"; continue; }
  FUZZ_SEED=$s FUZZ_ACTIONS=$OUT/min-$s.json FUZZ_OUT=$OUT/replay-$s.txt npx vitest run --config $CONFIG fuzz/replay.test.js >/dev/null 2>&1
  FUZZ_SEED=$s FUZZ_ACTIONS=$OUT/min-$s.json FUZZ_ROOT=$MAIN FUZZ_OUT=$OUT/replay-main-$s.txt npx vitest run --config $CONFIG fuzz/replay.test.js >/dev/null 2>&1
  n=$(python3 -c "import json;print(len(json.load(open('$OUT/min-$s.json'))))")
  hk=$(sed -n '/--- violations/,/--- server log/p' $OUT/replay-$s.txt | grep -o '"inv":"[A-Z0-9]*","kind":"[a-z0-9-]*"' | sed 's/"inv":"//;s/","kind":"/:/;s/"//' | sort -u | tr '\n' ' ')
  mk=$(sed -n '/--- violations/,/--- server log/p' $OUT/replay-main-$s.txt | grep -o '"inv":"[A-Z0-9]*","kind":"[a-z0-9-]*"' | sed 's/"inv":"//;s/","kind":"/:/;s/"//' | sort -u | tr '\n' ' ')
  acts=$(sed -n '/--- trace/,/--- violations/p' $OUT/replay-$s.txt | grep -E '^[0-9]+:' | sed 's/^[0-9]*: //' | cut -c1-60 | tr '\n' ';')
  echo "seed $s n=$n\n  HEAD: $hk\n  main: $mk\n  acts: $acts"
done
