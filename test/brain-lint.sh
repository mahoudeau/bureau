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
if echo "$VALID" | grep -q 'missing "summary"'; then FAIL=$((FAIL+1)); echo "  FAIL: valid brain warns about a summary"
else PASS=$((PASS+1)); echo "  ok: every summary-bearing file has one, knowledge/INDEX.md exempt"; fi
check "no warnings at all (summaries, Now)" "$VALID" ' 0 warnings'

echo "2. a malformed brain fails on each planted defect"
INVALID=$(node hub/tools/brain-lint.js test/fixtures/brain-invalid); IX=$?
check "exit code 1" "exit:$IX" 'exit:1'
check "unsourced observation caught" "$INVALID" 'unsourced observation'
check "dangling wikilink caught" "$INVALID" 'dangling wikilink'
check "missing frontmatter caught" "$INVALID" 'missing frontmatter'
check "attic lineage gap caught" "$INVALID" 'missing "retired_reason"'
check "unresolved superseded_by caught" "$INVALID" 'superseded_by does not resolve'
check "scope-location mismatch caught" "$INVALID" 'does not match location'
check "missing scope on v2 note caught" "$INVALID" 'missing "scope"'
check "unknown compartment folder warned" "$INVALID" 'unknown compartment folder'
check "missing summary warned" "$INVALID" 'warn: knowledge/no-summary.md: missing "summary"'
check "over-long summary caught" "$INVALID" 'ERROR: knowledge/long-summary.md: summary is .* over the 200 limit'
check "duplicate rule id caught" "$INVALID" 'duplicate rule id RULE-BROKEN-01'
check "unsourced rule caught" "$INVALID" 'rule RULE-BROKEN-02 has no source'
check "missing Now warned" "$INVALID" 'warn: projects/no-now/STATE.md: no "## Now" section'
check "over-long Now warned" "$INVALID" 'warn: projects/long-now/STATE.md: "## Now" is 31 lines, over the 30 limit'
check "prose in a file-level source caught" "$INVALID" 'ERROR: recipes/bad-file-source.md: frontmatter "source" holds a malformed ref "the boss said so"'
check "a malformed file source covers nothing" "$INVALID" 'ERROR: recipes/bad-file-source.md: unsourced observation'
check "prose in a source group warned" "$INVALID" 'warn: recipes/prose-source.md: source group holds prose'
check "a prose group is no source" "$INVALID" 'ERROR: recipes/prose-source.md: unsourced observation'

echo "2b. v0.3 provenance: mission ids and a file-level source count"
if echo "$VALID" | grep -q 'recipes/descale-coffee.md'; then FAIL=$((FAIL+1)); echo "  FAIL: descale-coffee.md (file source t-12, a line with (source: t-31)) is flagged"
else PASS=$((PASS+1)); echo "  ok: a t- id and a file-level source are both accepted"; fi
ONE=$(node -e "const l=require('./hub/tools/brain-lint.js');const r=l.lintFile('test/fixtures/brain-valid','recipes/refill-coffee.md','---\ntitle: x\nsummary: \"x\"\ncompartment: recipe\npermalink: refill-coffee\nversion: 1\n---\n\n- [step] no source here\n');console.log(JSON.stringify(r))")
check "lintFile reports one file's errors only" "$ONE" 'recipes/refill-coffee.md: unsourced observation'
if echo "$ONE" | grep -q 'descale-coffee'; then FAIL=$((FAIL+1)); echo "  FAIL: lintFile leaked another file's result"
else PASS=$((PASS+1)); echo "  ok: lintFile keeps to the file it was asked about"; fi

echo "3. the repo's own specs (docs/specs) pass as a project's specs/"
SPECS_BRAIN=$(mktemp -d)
mkdir -p "$SPECS_BRAIN/projects/bureau/specs"
cp docs/specs/*.md "$SPECS_BRAIN/projects/bureau/specs/"
SPECS=$(node hub/tools/brain-lint.js "$SPECS_BRAIN"); SX=$?
rm -rf "$SPECS_BRAIN"
check "specs lint passes" "$SPECS" 'LINT PASSED'
check "specs exit code 0" "exit:$SX" 'exit:0'
check "specs are linted" "$SPECS" '^3 files'
check "specs carry no warnings" "$SPECS" ' 0 warnings'

echo "4. journal records (v0.3): lenient, but a broken record in a format 0.3 day is warned"
JOURNAL_BRAIN=$(mktemp -d)
mkdir -p "$JOURNAL_BRAIN/journal"
cp test/fixtures/claims/valid/journal/2026-10-02.md test/fixtures/claims/invalid/journal/2026-10-03.md "$JOURNAL_BRAIN/journal/"
printf -- '- [lesson] a v0.2 day, free text\n' > "$JOURNAL_BRAIN/journal/2026-10-01.md"
JOURNAL=$(node hub/tools/brain-lint.js "$JOURNAL_BRAIN"); JX=$?
rm -rf "$JOURNAL_BRAIN"
check "a broken journal record still passes lint" "exit:$JX" 'exit:0'
check "and is warned with its line and code" "$JOURNAL" 'warn: journal/2026-10-03.md: line 7: E_EVIDENCE'
check "a well-formed day and a v0.2 day are not warned" "$JOURNAL" ' 1 warnings'

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ] && echo "BRAIN-LINT OK." || echo "BRAIN-LINT BROKEN."
exit $FAIL
