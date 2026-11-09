#!/usr/bin/env bash
# Memory eval (roadmap R1): recall@5 of brain retrieval, and tokens per clock-in.
# The harness comes before any retrieval or scoring work, so every later change
# is measured against a recorded number. All fixture data is deliberately fake.
#
# Usage:
#   ./test/memory-eval.sh
#       Self-test. Boots a scratch hub on $EVAL_PORT (default 4742) seeded with
#       test/fixtures/brain-eval, runs test/memory-eval/example.json through
#       every method, checks the numbers, stops the hub. Scratch files go to
#       $EVAL_TMP (default: a fresh mktemp dir).
#
#   ./test/memory-eval.sh run [run.js options]
#       Passes everything to test/memory-eval/run.js. Examples:
#         ./test/memory-eval.sh run --questions my.json --url http://localhost:8100 --token devtoken
#         ./test/memory-eval.sh run --questions my.json --hub-sh connectors/claude-code/hub.sh \
#             --include knowledge/,recipes/,projects/bureau/ \
#             --clockin knowledge/,recipes/,projects/bureau/STATE.md
#       Every hub call is a GET, so pointing it at a live hub is read-only.
#       Run with "run --help" for every flag.
set -u
cd "$(dirname "$0")/.."

if [ "${1:-}" = "run" ]; then
  shift
  exec node test/memory-eval/run.js "$@"
fi

# The recall@5 recorded for test/memory-eval/example.json on the fixture
# brain (list method). A floor, not an exact match: CI fails when retrieval
# scores below it, and a better score passes. Raise it when one lands.
BASELINE=0.875

PORT="${EVAL_PORT:-4742}"
TMP="${EVAL_TMP:-$(mktemp -d)}"
URL="http://127.0.0.1:$PORT"
PASS=0; FAIL=0

check () { # check <label> <haystack> <needle>
  if echo "$2" | grep -q -- "$3"; then PASS=$((PASS+1)); echo "  ok: $1"
  else FAIL=$((FAIL+1)); echo "  FAIL: $1"; echo "    wanted: $3"; fi
}

rm -rf "$TMP/data" "$TMP/brain"
mkdir -p "$TMP/data"
cp -R test/fixtures/brain-eval "$TMP/brain"

# BUREAU_ENV_FILE: a missing file, so a local hub/.env (and its token) stays out
env -u BUREAU_TOKEN PORT="$PORT" HOST=127.0.0.1 BUREAU_DATA_DIR="$TMP/data" BUREAU_BRAIN_DIR="$TMP/brain" BUREAU_ENV_FILE="$TMP/no.env" \
  node hub/server.js > "$TMP/hub.log" 2>&1 &
HUB=$!
trap 'kill $HUB 2>/dev/null' EXIT

if ! curl -s -o /dev/null --retry 20 --retry-connrefused --retry-delay 1 "$URL/health"; then
  echo "hub did not come up on $URL; log:"; cat "$TMP/hub.log"; exit 1
fi

echo "1. the list baseline over the fake brain"
OUT=$(node test/memory-eval/run.js --questions test/memory-eval/example.json --url "$URL" --method list --min-recall "$BASELINE"); X=$?
echo "$OUT" | sed 's/^/    /'
check "recall@5 at or above the recorded $BASELINE" "exit:$X" 'exit:0'
check "the score is printed" "$OUT" 'recall@5 [01]\.[0-9]*'
# A question below full recall is named, so a regression says where it is
if echo "$OUT" | grep -q 'recall@5 1\.000'; then PASS=$((PASS+1)); echo "  ok: nothing missed"
else check "a miss is named" "$OUT" '^ *\(MISS\|part\) '; fi
check "entities/ stays out of the ranking" "$OUT" 'exclude: entities/'
if echo "$OUT" | grep -q 'entities/acme'; then FAIL=$((FAIL+1)); echo "  FAIL: an entity file was ranked"; else PASS=$((PASS+1)); echo "  ok: no entity file ranked"; fi

echo "2. api-search reports itself unavailable until R4 ships it"
OUT=$(node test/memory-eval/run.js --questions test/memory-eval/example.json --url "$URL" --method api-search); X=$?
echo "$OUT" | sed 's/^/    /'
check "runs clean" "exit:$X" 'exit:0'
check "not available, cleanly" "$OUT" 'method api-search: not available'

echo "3. --min-recall gates CI"
node test/memory-eval/run.js --questions test/memory-eval/example.json --url "$URL" --method list --min-recall 0.8 > /dev/null; X=$?
check "passes at 0.8" "exit:$X" 'exit:0'
node test/memory-eval/run.js --questions test/memory-eval/example.json --url "$URL" --method list --min-recall 1.01 > /dev/null; X=$?
check "fails above any possible score (1.01)" "exit:$X" 'exit:1'

echo "4. tokens per clock-in"
OUT=$(node test/memory-eval/run.js --url "$URL" --clockin knowledge/,recipes/,projects/demo/STATE.md); X=$?
echo "$OUT" | sed 's/^/    /'
check "runs clean" "exit:$X" 'exit:0'
check "reads 8 files" "$OUT" 'clock-in: 8 files'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "MEMORY-EVAL OK." || echo "MEMORY-EVAL BROKEN."
exit $FAIL
