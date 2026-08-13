#!/usr/bin/env bash
# brain-lint acceptance: the valid fixture passes, the invalid fixture trips
# every rule it was built to trip. All fixture data is deliberately fake.
#
# Usage: ./test/brain-lint.sh
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0

check () { # check <label> <haystack> <needle>
  if echo "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ok: $1"
  else FAIL=$((FAIL+1)); echo "  FAIL: $1"; echo "    wanted: $3"; fi
}

echo "1. a well-formed brain passes"
VALID=$(node hub/tools/brain-lint.js test/fixtures/brain-valid); VX=$?
check "lint passes" "$VALID" 'LINT PASSED'
check "exit code 0" "exit:$VX" 'exit:0'

echo "2. a malformed brain fails on each planted defect"
INVALID=$(node hub/tools/brain-lint.js test/fixtures/brain-invalid); IX=$?
check "exit code 1" "exit:$IX" 'exit:1'
check "unsourced observation caught" "$INVALID" 'unsourced observation'
check "dangling wikilink caught" "$INVALID" 'dangling wikilink'
check "missing frontmatter caught" "$INVALID" 'missing frontmatter'
check "attic lineage gap caught" "$INVALID" 'missing "retired_reason"'
check "unresolved superseded_by caught" "$INVALID" 'superseded_by does not resolve'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "BRAIN-LINT OK." || echo "BRAIN-LINT BROKEN."
exit $FAIL
