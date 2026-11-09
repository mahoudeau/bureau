# Answer eval

This measures whether Bureau's context call makes an LLM agent answer better. The memory eval in `test/memory-eval` measures retrieval and token size. This one measures the answers.

It runs the same model on the same questions under five conditions:

- A: no context.
- B: a clock-in dump, the project's `STATE.md` plus every file in `knowledge/` and `recipes/`.
- C: the passages returned by `POST /api/context` at the default budget.
- D: no injected context, but read-only tools (Read, Grep, Glob) over a copy of what the project may see.
- E: the oracle, only the expected section of the brain, as a ceiling. On unanswerable questions E gets nothing.
- F: the passages and map from C, plus the tools from D, with D's system prompt. Real sessions have both. Run it with `--conditions F`. A set of results kept beside the others joins the report with `--also PREFIX`.

## What you need

Node, the `claude` CLI, and a copy of a brain on disk. There are no dependencies. Question files are passed as arguments and stay out of this repository, because real questions quote real content.

A questions file is a JSON array of `{id, project, question, expected: [{file, section?}], must_contain, tags}`. A guards file is a JSON array of `{id, kind: "negative" | "wall", project, question}`. Those questions have no answer in what the project can see. Files given with `--heldout` are marked as held out from tuning in the report.

## How to run it

Every step takes `--out DIR`. Nothing is sent to a real hub. `prepare.js` starts a local hub on a copy of the brain, on 127.0.0.1, and stops it afterwards.

```sh
node prepare.js --brain BRAIN --questions Q.json --heldout H.json --guards G.json --out OUT
node isolation.js --brain BRAIN --out OUT
node answer.js --out OUT --only id1,id2,id3,id4,id5 --reps 1 --results OUT/smoke-answers.jsonl
node answer.js --out OUT --reps 3 --concurrency 4
node judge.js --out OUT
node verify.js --out OUT
node report.js --out OUT
```

`prepare.js` checks that every expected passage exists in the brain and lists any it dropped in `prepare-report.json`. `answer.js` is resumable: a run that is already in `answers.jsonl` is skipped.

## Isolation

Every run uses `claude -p` with `--safe-mode`, an empty `--setting-sources`, `--strict-mcp-config`, a fixed system prompt and no session persistence, so that no user hook, `CLAUDE.md`, plugin or MCP server is loaded. Condition D adds `--restricted`, which confines the file tools to the project's copy of the brain.

`isolation.js` proves it. A control run that loads the user settings must fire the `UserPromptSubmit` hook and hit a scratch hub, and an isolated run must not. Each benchmark run also checks its own init message and counts hook events, and stops the benchmark on any surprise. The child environment points `BUREAU_URL` at a closed local port and `BUREAU_HOOK_LOG` at a canary file, so a hook that fired anyway could not reach a real hub and would leave a trace.

## Grading

Mechanical: whether the answer contains `must_contain`. This is a weak signal in French, where the answer may translate the phrase.

Judge: a separate run with its own seed order. It sees the project, the question, the reference passage and an answer under an opaque id, never the condition. It scores correct, partly, wrong or abstained. On unanswerable questions an abstention is the correct answer. Identical answers to one question are judged once.

The judge also flags fabrication, and quotes the claims it doubts. Because a judge holding one reference passage flags true facts from elsewhere in the brain, `verify.js` sends only the flagged answers to a second run that holds everything that project may see. It can clear a flag and cannot add one. Without this step, conditions that inject more material would look worse than they are. `--recheck-from FILE` with `--verified OUT/verified-recheck.jsonl` redoes only the flags an earlier pass left standing, and the report takes the later ruling.

The report gives hallucination twice: every standing flag, and only the flags on answers that did not abstain. An answer can say it does not know and still make a loose remark about what the notes cover, which is a different failure from inventing an answer.

## The report

`report.js` writes `report.md`, `summary.json` and `graded.json`. Accuracy, hallucination rate, abstention, input tokens and latency are reported per condition, overall and split by English, French and unanswerable, with tuned and held-out questions marked. Intervals are bootstrap 95% over questions, not runs, and every condition is compared with C on the same questions.

## Limits

The hub's relevance floor and glossary were set on the tuned questions, so held-out numbers are the ones to trust. Held-out questions are all French, so nothing here measures held-out English. Input tokens count everything the model was sent, including cached context and every turn of condition D. One model and one brain were measured.
