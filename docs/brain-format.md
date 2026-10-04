# Bureau Brain Format (v0.3, draft)

*This specification and the `brain-lint` validator are licensed Apache-2.0 (LICENSE-APACHE at the repo root); your brain and your tools owe nothing to the AGPL hub.*

The file format for Bureau brains. Plain markdown, built from the open commons every markdown-graph tool shares: YAML frontmatter, `[[wikilinks]]`, `#tags`, categorized list items. Prior art gladly credited: Obsidian and Roam popularized wikilink graphs; [Basic Memory](https://github.com/basicmachines-co/basic-memory) showed how far observations and typed relations inside plain markdown can go. This spec uses the same commons grammar and adds a policy layer those formats do not have: provenance, belief status, freshness, lineage, and scope, all machine-checkable.

Design rule inherited from the rest of Bureau: the format is a contract, so it ships with a validator. A brain either passes lint or it does not.

## The two axes (what v0.1 got wrong)

v0.1 classified files by memory type only: episodic, semantic, procedural, cold, retired. Then real work started, and the live brain immediately grew folders the spec never named: `projects/<slug>/STATE.md`, `agents/<name>.md`. The divergence taught the lesson this version encodes: **memory type and scope are orthogonal axes.** Memory type answers "what kind of remembering is this"; scope answers "whose knowledge is this, and who may see it". A debrief is semantic *and* belongs to one project. A tone-of-voice rule is semantic *and* belongs to one company. v0.1 had an answer for the first axis and nothing for the second, so working agents invented the second on disk, correctly. v0.2 makes both axes official: **scope is the folder geography, memory type is the role a file plays inside its scope.**

## Scope

Four levels, from widest to narrowest:

1. **Global**: the owner. Voice, universal preferences, cross-cutting facts and how-tos.
2. **Entity** (`entities/<slug>/`): an organization or context with its own policies, tone, glossary, and walls. An employer, a client, a personal venture. Deliberately not called "client": no billing relationship is implied.
3. **Project** (`projects/<slug>/`): one stream of work. A project belongs to at most one entity (the hub's project registry holds the join).
4. **Mission**: a single piece of work. Its log lives in hub state, not the brain; what deserves to outlive it gets distilled upward at debrief time.

Three laws govern scope:

- **File at the scope where the fact is true.** "No em dashes" is global. "Acme never names competitors" is entity. "This repo uses tabs" is project. A learning filed one level too high is a future leak or a future wrong answer.
- **Precedence: nearest scope wins.** An agent working a mission loads the chain top-down: global, then the project's entity, then the project. More specific overrides more general. Conflicts across scopes are resolved by the cascade; conflicts at the same scope are real contradictions and go to the human.
- **Walls: reads go down the chain only.** An agent working an Acme mission reads global, `entities/acme/`, and its project. It never reads another entity's tree, ever. Cross-pollination happens only through promotion (below). In v0.2 the wall is law enforced by standing prompts; hub-enforced scoped reads are a planned refinement.

**Promotion and demotion.** The librarian may propose lifting a lesson to a wider scope (the same fact learned independently under three entities, generalized and stripped of anything entity-identifying) or scoping a general rule down (one entity contradicts it, so it becomes their exception). Both are review-gated: a human signs every scope change.

## Layout

A brain is a git repository. Files also self-describe via frontmatter, so a file survives being copied out of its folder.

```
brain/
  journal/<yyyy-mm-dd>.md    # episodic, global inbox: one-line captures from any surface
  meetings/<date>-<topic>.md # episodic: meeting notes and transcript digests
  import/<source>/           # episodic: cold-start staging, disposable after digestion
  knowledge/                 # semantic, global scope: curated, authoritative
  recipes/                   # procedural, global scope: extracted how-tos
  entities/<slug>/
    PROFILE.md               # the walls doc: policies, tone of voice, glossary, do-nots
    knowledge/               # semantic, entity scope (same strictness as global)
    recipes/                 # procedural, entity scope
  projects/<slug>/
    STATE.md                 # working semantic: "## Now" on top, debriefs below
    decisions.md             # append-only decision log, dated
    learnings.md             # append-only "things we found out", dated
    specs/<domain>.md        # what the product does: actors, numbered rules, journeys, edge cases
    deliverables/            # documents produced by missions
    references/              # goal-bar material: images, PDFs, examples (attachments)
  agents/<name>.md           # roster profiles: role, standing brief, lessons
  daily/<yyyy-mm-dd>.md      # the librarian's digests
  archive/                   # cold: digested episodic raw, mirrors source paths
  attic/                     # retired beliefs with lineage, mirrors source paths
```

Verbatim meeting transcripts stay out of the repo: they are bulky, mostly noise, and other people's words. Store them elsewhere and keep a pointer; what enters `meetings/` is the digest.

Binary attachments (`.png .jpg .jpeg .gif .svg .pdf`, small) are allowed as episodic-grade material: goal-bar references under `projects/<p>/references/`. No frontmatter, no lint; they exist to be pointed at, and anything durable they teach still gets promoted as a sourced note.

Review evidence (the screenshot of round 14, a test log, a draft nobody will reread) is not brain material at all. In Bureau it goes to the hub's work store, `work/<t-id>/`, outside the brain repo: plain files, no git, deleted whole when the mission closes. What a round teaches is filed in the brain as a sourced note; the pictures that proved it leave with the mission.

## The curation law

Who writes where, and who may rewrite. "The librarian" is the curation agent (in Bureau's office, the archivist); its rewrites run review-gated until the owner lifts the gate.

| Path | Who writes | Mode | Who may rewrite |
|---|---|---|---|
| `journal/` | anyone | append, cheap, minimal structure | librarian consumes (digested days move to `archive/`) |
| `meetings/`, `import/` | anyone | dump raw | librarian digests, then moves raw to `archive/` |
| `knowledge/`, `recipes/` (global and entity) **[hub]** | librarian promotion or reviewed missions | structured notes, provenance mandatory | librarian; nothing deleted, retired to `attic/` |
| `entities/<slug>/PROFILE.md` **[hub]** | owner and librarian | replace, review-gated | owner and librarian |
| `projects/<slug>/STATE.md` | working agents | append debriefs | librarian may compact wholesale (original to `archive/`) |
| `projects/<slug>/decisions.md`, `learnings.md` | working agents | append-only, dated | nobody; corrections are new entries, retirement via `attic/` |
| `projects/<slug>/specs/` | reviewed missions and the owner | replace, one domain per file | same; a rule keeps its id for life, a dropped rule leaves its id unused |
| `agents/<name>.md` | the agent itself and the librarian | replace | same |
| `attic/` **[hub]** | librarian only | per compartment rules | librarian only |
| `daily/`, `archive/` | librarian only | per compartment rules | librarian only |

Rows marked **[hub]** are enforced by the Bureau hub, not only by the standing prompts: its knowledge API refuses a write there (403, nothing written or committed) unless it comes from the owner, an agent holding the `librarian` role, or one holding `curator`, a write-only grant the owner gives an agent he works with live. Who holds a role is the hub's settings (`docs/protocol.md`, Settings). The other rows are law by convention: the API takes any authenticated write and the librarian's review catches the rest. The owner's hand edits are never refused; the intake sweep commits them.

**Write cheap, curate later** still rules: working agents are never asked to file perfectly. The journal accepts anything; the librarian's job is making it authoritative or letting it fade.

## The Now section

Every project `STATE.md` opens with `## Now`, right after its frontmatter: current status, open threads, next step. Thirty lines at most. It is rewritten in place when the picture changes, never appended to; history and debriefs go below it. An agent reads `## Now` first and fetches the history below only when the work needs it. Lint warns when a `STATE.md` has no `## Now` or when it runs over 30 lines.

## The debrief grammar

Every completed mission appends a debrief to its project's `STATE.md`, below `## Now`. Three parts, minimum, in this order:

- **What changed**: the work, stated concretely.
- **What was learned**: anything reusable; name the scope if it is not the project's own.
- **Next step**: what a cold-started successor should do first.

Optionally `earned_by:` the mission id. This shape is what the librarian digests and what lint will eventually check; free-form prose around it is welcome, the three parts are not optional.

## Specs: what the product does

`STATE.md` says where the work stands. A spec says what the product does, so an agent can answer "how does X behave" from the brain instead of reading the code. One file per domain: `projects/<slug>/specs/<domain>.md`, in four parts:

- **Actors**: who acts in this domain (people, agents, the hub itself).
- **Rules**: one list item per rule, starting with its id: `- RULE-<DOMAIN>-01: statement. (source: ...)`. The domain is uppercase letters and digits; numbers are two digits or more.
- **Journeys**: the common paths, step by step, citing rule ids.
- **Edge cases**: what happens at the borders, citing rule ids.

Every rule carries a `(source: ...)`: a `file:line` in the code, a doc and its section, or a `[[wikilink]]` to the decision or mission that set it. A rule nobody can trace is an opinion. Ids are stable: a rewritten rule keeps its id, a dropped rule leaves its number unused, so a mission note citing `RULE-REVIEW-04` still means the same thing a year later. Only rule lines start a list item with an id; journeys and edge cases cite ids in the text.

A spec's frontmatter: `title`, `compartment: spec`, `scope: project:<slug>`, `summary`.

Specs describe behavior, not intent. When the code and the spec disagree, the code is the fact and the spec is the bug, unless a decision says otherwise; either way the mission that finds the gap says so.

## Note grammar (the commons layer)

A note is markdown with YAML frontmatter. Observations are categorized list items; relations are typed wikilinks. This layer is deliberately compatible with the wider markdown-graph ecosystem: these files parse as ordinary notes in Obsidian, and tools that understand observation/relation grammar can index them unchanged.

```markdown
---
title: Deploy process for the hub
summary: Push to main, CI checks, the host restarts on pull; watch the IPv6 bind.
compartment: recipe
scope: global
permalink: deploy-hub
version: 2
source: t-12
---

- [step] Push to main; CI runs the conformance script #deploy
- [step] The host restarts the Node site on git pull #deploy
- [gotcha] The IPv6 bind fails on some hosts; the server falls back to IPv4 (source: [[journal/2026-08-11]])

## Relations
- part_of [[Hub operations]]
- supersedes [[attic/recipes/deploy-hub-v0]]
```

- Observation: `- [category] statement #tags (source: [[target]])`
- `source:` in the frontmatter covers the observations that carry no source of their own; here the two `[step]` lines come from mission t-12 (see Claims, below)
- Relation: `- relation_type [[Target]]`; bare wikilinks in prose are implicit relations
- `permalink`: stable identifier that survives file moves; all lineage and source links prefer permalinks
- `scope`: `global`, `entity:<slug>`, or `project:<slug>`; lets a copied file remember its walls

## The policy layer (Bureau extensions)

Extra frontmatter fields and grammar rules. In other tools they are inert custom metadata; in Bureau they are enforced.

**Provenance (enforced in knowledge/ and recipes/, global and entity).** Every observation has at least one source: its own `(source: ...)`, its own `source:` field (long form), or its file's `source:`. A source is a journal record (`j-` id), a mission (`t-` id), or a wikilink to journal material or another note (see Refs, below). An unsourced claim is a lint error, not a style issue. This is what keeps the authoritative layer free of hallucinated facts.

**Summary (required on the files a scope load reads first).** `summary:` is one line, 200 characters or fewer, saying what the file holds. Required on `knowledge/` and `recipes/` notes (global and entity), `entities/<slug>/PROFILE.md`, and `projects/<slug>/STATE.md`. One exemption: `knowledge/INDEX.md` (global or entity), which is a map itself. It is what a map or a search result shows next to the file name, so an agent can decide what to open without opening everything. A `STATE.md` that has no frontmatter gets a minimal block (`title`, `summary`) above its `## Now`; appends land below. Missing is a lint warning, over length is an error.

**Belief status.** `belief: hypothesis | validated | superseded`. Hypothesis: asserted once. Validated: confirmed by independent debriefs or human review; the promotion is an event with a source. Superseded: lives in the attic. Consumers surface it: an agent quoting a hypothesis says so.

**Imports are hypotheses.** Material entering through `import/` or `meetings/` is promoted with `belief: hypothesis` and an observation-level marker `(imported <date> from <source>)`. It stays marked until real reviewed work confirms or contradicts it; earned and imported knowledge remain distinguishable forever.

**Earned-by.** `earned_by: [[missions/t-42]]` links a note to the reviewed work that produced it. Optional but valued: it is the difference between remembered and earned.

**Freshness.** `volatility: volatile | stable | durable` (defaults stable). Volatile facts (prices, versions, contacts) get `verified:` dates; a stale volatile fact is a lint warning and, in Bureau, a re-verification mission.

**Lineage.** Retirement moves a file to `attic/` preserving its path and stamps `retired:` (date), `retired_by:`, `retired_reason:`, `superseded_by: [[...]]`. The replacement carries `supersedes: [[...]]`. Both directions are lint-checked: no orphan retirements, no unexplained replacements.

**Versioning.** `version:` on every structured note; the spec itself is versioned so conventions can migrate without breaking old files. Notes written under v0.1 (`version: 1`) remain valid; the `scope` field is required from `version: 2` on, in authoritative compartments only. `version:` counts a note's own revisions; `format:` (from v0.3) names the grammar its claims are written in. They move independently (see Format versions, below).

## Claims (v0.3)

v0.2 called any list item starting with `[category]` an observation and let each tool read it its own way. v0.3 makes it a **claim**: one grammar, read the same way by the hub, the linter and the search index, and written by the hub itself when it captures for an agent. A claim has two forms.

**Short form.** One line, the default in curated notes:

```markdown
- [gotcha] lftp --exclude-glob skips .gitignore but not the .git directory #deploy (source: j-4f2a91c0, t-356) ^c-8k2m1q
```

**Long form.** A first line, then one field per sub-line. For a claim that needs more than its file's defaults, and always for journal records:

```markdown
- [fact] A recreated alwaysdata site gets a new site id ^c-2p9x4d
  - source: t-356, j-71b0c2aa
  - volatility: volatile
  - verified: 2026-09-22
  - contradicts: c-5h1k0z
```

### Grammar

Short form, left to right:

1. `- [kind] ` at the start of a top-level list item.
2. **The text.** One physical line. Tags are `#word` tokens after whitespace (`[a-z0-9][a-z0-9-]*`); they stay in the text and are also listed as the claim's tags.
3. **The source group**, optional: the first parenthesized group that starts with `source:` and whose items, comma-separated, are all refs (below). A group holding anything else is text, not a source.
4. **The source note**, optional: whatever follows the source group, kept verbatim. Example: `(source: [[journal/2026-08-16]]) (kassad entry)`.
5. **The id**, optional in short form: ` ^c-xxxxxx` at the very end.

Long form:

1. `- [kind] text ^id`. The id is required.
2. Sub-lines `  - key: value`: two spaces of indent, one field each, keys from the field table, each key at most once. Readers accept any order; the hub writes the table's order.
3. The first line's text is kept verbatim: in long form, tags come only from the `tags:` field and sources only from the `source:` field, so a `#word` or a `(source: ...)` in the text stays text.

Text rules, both forms: one physical line in a `format: 0.3` file (no hard wrap); 2000 characters at most; never contains `^c-` or `^j-`. Lines that are not claims (headings, prose, relations) are allowed and the claim parser skips them.

### Kinds

A closed list: `fact`, `gotcha`, `step`, `rule`, `why`, `decision`, `preference`, `correction`, `question`, `process`, `pattern`. Adding a kind is an additive format change.

The list binds `format: 0.3` files only. v0.2 files keep whatever categories they grew (journals and project notes use `[stated]`, `[lesson]`, `[craft]`, agent names). A migration maps them: a category that says how the writer knows (`[stated]`) becomes the `confidence` field, one that names a kind of lesson (`[lesson]`, `[craft]`) becomes `pattern` or `rule`, an agent name becomes `by`.

### Ids

- `c-` and 6 characters `[a-z0-9]` for claims in notes; `j-` and 8 for journal records.
- The hub assigns them when it writes. Unique across the brain, never reused, even after retirement: the attic keeps the id.
- `^id` is an Obsidian block reference, so `[[recipes/deploy-hub#^c-8k2m1q]]` links one claim in any tool that knows block references.

### Refs: what a source can be

| Ref | Example | Points to |
|---|---|---|
| journal record | `j-4f2a91c0` | one captured record |
| mission | `t-356` | a mission in the hub, with its log |
| wikilink | `[[journal/2026-08-11]]`, `[[deploy-hub#^c-8k2m1q]]` | a file, a permalink, or one claim |

A validator with access to the hub checks that `j-` and `t-` refs exist; offline, lint checks their syntax and resolves wikilinks.

### Fields

Every field has a reader. Numbers the index computes (truth, importance, reads, citations) are never fields: they live in the derived index, below.

| Key | Where | Value | Read by |
|---|---|---|---|
| `source` | claim, file | refs, comma-separated | provenance checks, evidence counts |
| `belief` | file, claim | `hypothesis`, `validated`, `superseded` | answers that quote the claim |
| `volatility` | file, claim | `volatile`, `stable`, `durable` | freshness |
| `verified` | file, claim | `yyyy-mm-dd` | freshness |
| `pinned` | claim | `true` (owner only) | freshness: a pinned claim does not decay |
| `contradicts` | claim | claim ids | contradiction review |
| `supersedes` | claim | claim ids | lineage |
| `believed-until` | claim | `yyyy-mm-dd` | lineage: when it stopped being believed |
| `evidence` | journal record | one line | the record's proof |
| `by` | journal record | an agent name | stamped by the hub |
| `mission` | journal record | a `t-` id | stamped by the hub from the agent's lease |
| `at` | journal record | ISO 8601, UTC | stamped by the hub |
| `confidence` | journal record | `observed`, `stated`, `inferred` | how the writer knows: saw it, was told it, concluded it |
| `tags` | journal record | `#tags`, space-separated | search, digests |

### Inheritance

A claim reads `belief`, `volatility` and `verified` from its own fields first, then from its file's frontmatter (`volatility` defaults to `stable`). A claim with no source of its own is covered by its file's `source:`. When the hub writes a note, a claim **added** by that write must bring its own source: the file-level source covers the claims that were already there, never new ones.

## Journal records (v0.3)

The journal stays write-cheap, but agents no longer type it. They send a capture to the hub (JSON: `kind`, `text`, `evidence`, optional `tags` and `confidence`); the hub validates it, stamps it, and appends a long-form claim to `journal/<yyyy-mm-dd>.md`:

```markdown
- [gotcha] lftp --exclude-glob .git* skips .gitignore but not the .git directory ^j-4f2a91c0
  - evidence: deployed mews twice, the remote tree held the whole history
  - by: consul
  - mission: t-356
  - at: 2026-10-02T12:32Z
  - confidence: observed
  - tags: #deploy #lftp
```

- **From the writer:** `kind`, `text`, `evidence` (required), `tags`, `confidence` (default `observed`).
- **From the hub, refused if sent:** the id, `by`, `at`.
- **`mission`** is stamped from the writer's lease. A writer holding several missions may name the one the record belongs to; naming a mission it does not hold is refused, and holding none writes no `mission` line.
- A journal day written this way carries `format: 0.3` in its frontmatter. Journal days without it are v0.2 free text and stay readable as they are.

## The parsed form

What every reader returns, so the hub, lint and the index agree. Per file:

```json
{ "format": "0.3", "frontmatter": { "title": "..." }, "claims": [ ... ], "errors": [ ... ] }
```

Per claim:

```json
{
  "id": "c-8k2m1q", "kind": "gotcha", "form": "short", "line": 12,
  "text": "lftp --exclude-glob skips .gitignore but not the .git directory #deploy",
  "tags": ["deploy"],
  "sources": [{ "ref": "j-4f2a91c0", "type": "record" }, { "ref": "t-356", "type": "mission" }],
  "source_note": null,
  "fields": {}
}
```

- `type` is `record`, `mission` or `wikilink`; a wikilink ref is stored without its brackets (`journal/2026-08-11`).
- `sources` lists the claim's own sources only; a file-level `source:` stays in `frontmatter`.
- `fields` holds every long-form field other than `source` and `tags`: values as written, `contradicts` and `supersedes` as arrays, `pinned` as a boolean.
- Frontmatter values are read as strings (`format` is `"0.3"`, `version` is `"3"`), so no reader turns `0.3` into a number.
- `line` is the claim's first line, counted from 1 at the top of the file, frontmatter included.

An error is `{ "code", "line", "message" }`:

| Code | Means |
|---|---|
| `E_KIND` | the kind is not in the list |
| `E_ID` | an id is malformed, or appears inside the text |
| `E_ID_DUP` | the same id twice in the brain |
| `E_ID_MISSING` | a long-form claim has no id |
| `E_FIELD` | a sub-line key is unknown, repeated, or malformed |
| `E_REF` | a ref in a `source:` field (a claim's or the file's) is malformed. In a short-form line, a group whose items are not all refs is text, not a source |
| `E_WRAP` | a claim's text continues on the next line in a `format: 0.3` file |
| `E_TOO_LONG` | the text is over 2000 characters |
| `E_UNSOURCED` | a claim in `knowledge/` or `recipes/` has no source, its own or its file's |
| `E_EVIDENCE` | a journal record has no `evidence` |

**Round trip.** For a claim written by the hub, parsing it and writing it back gives the same lines, byte for byte. That is a test, not a hope: the fixtures in `test/fixtures/claims/` hold each case with its expected parse.

## Format versions and change rules

- `format: 0.3` in the frontmatter says the file's claims follow this grammar. No `format:` means v0.2: read leniently (a hard-wrapped item is joined to its first line, ids may be missing), and never rewritten silently.
- Moving a file to v0.3 is a migration: ids and `format: 0.3` added in one commit, checked by lint.
- After v0.3, changes only add, and added fields are optional. A change that would break a reader bumps the format and ships with its migration. Readers keep reading every format they ever shipped.
- A field enters the table when something reads it, not before.

## The derived index

The files are the brain; the index is a cache of them. The hub builds it in SQLite from the files and the git history and can drop and rebuild it at any time. Nothing in it is canonical.

```
files(path, compartment, scope, belief, volatility, verified, summary, format)
claims(id, file, line, kind, text, belief, volatility, verified, pinned)
claim_sources(claim_id, ref, ref_type)
relations(from_id, type, to_id)        -- contradicts, supersedes, part_of
journal(claim_id, author, mission, at, confidence, evidence)
```

Computed numbers (truth, importance, read and citation counts, search ranks) live only here.

## What is enforced today

v0.3 is a draft. Its rules land in steps; until a step lands, the v0.2 rules stand.

| Rule | Enforced by |
|---|---|
| v0.2: schema, provenance, links, lineage, summaries, `## Now`, specs | `brain-lint`, today |
| Mission ids and file-level `source:` as provenance | `brain-lint`, today |
| A curated write that would fail lint is refused | the hub, on every write to a curated compartment, today |
| Journal records through the hub | the hub, on `POST /api/journal` and in a `format: 0.3` day, today; `brain-lint` warns on a record it cannot read |
| Drift measured: lint errors, unreadable records, approved text not applied, stale claims, contradictions, provenance coverage | the hub, `GET /api/memory/health`, today (measured and shown, not refused); CI runs lint and the memory eval on the fixture brains |
| Claim ids, ref existence, own sources on added claims | with claim ids, after typed capture |

## The linter

`brain-lint` ships with the hub: `node hub/tools/brain-lint.js <brain-dir>`, zero dependencies, Apache-2.0, exit 1 on errors. It enforces the frontmatter schema, provenance, dangling links, and attic lineage in authoritative compartments (global and entity `knowledge/` and `recipes/`); belief-status and freshness are warnings; a missing `summary` is a warning and one over 200 characters an error, on the summary-bearing files listed above; a project `STATE.md` without `## Now`, or with one over 30 lines, is a warning; in `projects/<slug>/specs/`, a duplicate rule id or a rule without a source is an error; episodic and working compartments (`journal/`, `meetings/`, `import/`, `projects/`, `agents/`, `daily/`) are deliberately lenient, because write-cheap is the law there. The full contract it grows into: schema per compartment · provenance coverage · link integrity · lineage completeness · belief-status transitions · debrief-grammar checks on STATE.md · freshness warnings. Lint status is part of a brain's health, next to the librarian's reports.

## Interoperability

Two-way, by design. Outbound: a Bureau brain is readable by any markdown tool, and tools that index observation/relation grammar (including Basic Memory) can index it directly; Bureau's extra fields degrade to inert metadata. Inbound: notes from other tools import into `import/` (or straight into `journal/` for small drops) as unsourced material with `belief: hypothesis`, which is precisely what an unreviewed note is; the librarian promotes what earns it. A converter ships both ways because the ownership promise requires the exit door to work.
