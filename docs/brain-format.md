# Bureau Brain Format (v0.2, draft)

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
    STATE.md                 # working semantic: current status, next steps, debriefs
    decisions.md             # append-only decision log, dated
    learnings.md             # append-only "things we found out", dated
    deliverables/            # documents produced by missions
    references/              # goal-bar material: images, PDFs, examples (attachments)
  agents/<name>.md           # roster profiles: role, standing brief, lessons
  daily/<yyyy-mm-dd>.md      # the librarian's digests
  archive/                   # cold: digested episodic raw, mirrors source paths
  attic/                     # retired beliefs with lineage, mirrors source paths
```

Verbatim meeting transcripts stay out of the repo: they are bulky, mostly noise, and other people's words. Store them elsewhere and keep a pointer; what enters `meetings/` is the digest.

Binary attachments (`.png .jpg .jpeg .gif .svg .pdf`, small) are allowed as episodic-grade material: goal-bar references under `projects/<p>/references/` stay in the brain (they're bar material, not evidence). Review-evidence screenshots and other work-in-progress deliverables go to `/api/work` instead (2026-08-17, bureau-internal/23 — see `docs/protocol.md`'s `/api/work` section): ungitted, per-mission, garbage-collected when the mission goes terminal, so the brain stops accumulating round-14-of-26 clutter nobody will read again. Binary attachments that DO belong in the brain (goal-bar references, anything meant to outlive its mission) carry no frontmatter, no lint; they exist to be pointed at, and anything durable they teach still gets promoted as a sourced note.

## The curation law

Who writes where, and who may rewrite. "The librarian" is the curation agent (in Bureau's office, the archivist); its rewrites run review-gated until the owner lifts the gate.

| Path | Who writes | Mode | Who may rewrite |
|---|---|---|---|
| `journal/` | anyone | append, cheap, minimal structure | librarian consumes (digested days move to `archive/`) |
| `meetings/`, `import/` | anyone | dump raw | librarian digests, then moves raw to `archive/` |
| `knowledge/`, `recipes/` (global and entity) ⚙ | librarian promotion or reviewed missions | structured notes, provenance mandatory | librarian; nothing deleted, retired to `attic/` |
| `entities/<slug>/PROFILE.md` ⚙ | owner and librarian | replace, review-gated | owner and librarian |
| `projects/<slug>/STATE.md` | working agents | append debriefs | librarian may compact wholesale (original to `archive/`) |
| `projects/<slug>/decisions.md`, `learnings.md` | working agents | append-only, dated | nobody; corrections are new entries, retirement via `attic/` |
| `agents/<name>.md` | the agent itself and the librarian | replace | same |
| `daily/`, `archive/`, `attic/` ⚙ (attic only) | librarian only | per compartment rules | librarian only |

⚙ **Hub-enforced, not just convention** (2026-08-17, bureau-internal/23 — see `docs/protocol.md`'s per-compartment write permissions). `POST /api/knowledge` refuses a write into `knowledge/`, `recipes/` (global or entity), `entities/<slug>/PROFILE.md`, or `attic/` from any `author` that isn't a librarian-capability agent or `"human"` — a `403`, not a convention a builder has to remember. Every other row in this table is still convention-only: the hub does not (yet) enforce `daily/`/`archive/` as librarian-only, or `agents/<name>.md` as self-plus-librarian-only.

**Write cheap, curate later** still rules: working agents are never asked to file perfectly. The journal accepts anything; the librarian's job is making it authoritative or letting it fade.

## The debrief grammar

Every completed mission appends a debrief to its project's `STATE.md`. Three parts, minimum, in this order:

- **What changed**: the work, stated concretely.
- **What was learned**: anything reusable; name the scope if it is not the project's own.
- **Next step**: what a cold-started successor should do first.

Optionally `earned_by:` the mission id. This shape is what the librarian digests and what lint will eventually check; free-form prose around it is welcome, the three parts are not optional.

## Note grammar (the commons layer)

A note is markdown with YAML frontmatter. Observations are categorized list items; relations are typed wikilinks. This layer is deliberately compatible with the wider markdown-graph ecosystem: these files parse as ordinary notes in Obsidian, and tools that understand observation/relation grammar can index them unchanged.

```markdown
---
title: Deploy process for the hub
compartment: recipe
scope: global
permalink: deploy-hub
version: 2
---

- [step] Push to main; CI runs the conformance script #deploy
- [step] The host restarts the Node site on git pull #deploy
- [gotcha] The IPv6 bind fails on some hosts; the server falls back to IPv4 (source: [[journal/2026-08-11]])

## Relations
- part_of [[Hub operations]]
- supersedes [[attic/recipes/deploy-hub-v0]]
```

- Observation: `- [category] statement #tags (source: [[target]])`
- Relation: `- relation_type [[Target]]`; bare wikilinks in prose are implicit relations
- `permalink`: stable identifier that survives file moves; all lineage and source links prefer permalinks
- `scope`: `global`, `entity:<slug>`, or `project:<slug>`; lets a copied file remember its walls

## The policy layer (Bureau extensions)

Extra frontmatter fields and grammar rules. In other tools they are inert custom metadata; in Bureau they are enforced.

**Provenance (enforced in knowledge/ and recipes/, global and entity).** Every observation carries at least one `(source: [[...]])` link to journal material or a mission. An unsourced claim is a lint error, not a style issue. This is what keeps the authoritative layer free of hallucinated facts.

**Belief status.** `belief: hypothesis | validated | superseded`. Hypothesis: asserted once. Validated: confirmed by independent debriefs or human review; the promotion is an event with a source. Superseded: lives in the attic. Consumers surface it: an agent quoting a hypothesis says so.

**Imports are hypotheses.** Material entering through `import/` or `meetings/` is promoted with `belief: hypothesis` and an observation-level marker `(imported <date> from <source>)`. It stays marked until real reviewed work confirms or contradicts it; earned and imported knowledge remain distinguishable forever.

**Earned-by.** `earned_by: [[missions/t-42]]` links a note to the reviewed work that produced it. Optional but valued: it is the difference between remembered and earned.

**Freshness.** `volatility: volatile | stable | durable` (defaults stable). Volatile facts (prices, versions, contacts) get `verified:` dates; a stale volatile fact is a lint warning and, in Bureau, a re-verification mission.

**Lineage.** Retirement moves a file to `attic/` preserving its path and stamps `retired:` (date), `retired_by:`, `retired_reason:`, `superseded_by: [[...]]`. The replacement carries `supersedes: [[...]]`. Both directions are lint-checked: no orphan retirements, no unexplained replacements.

**Versioning.** `version:` on every structured note; the spec itself is versioned so conventions can migrate without breaking old files. Notes written under v0.1 (`version: 1`) remain valid; the `scope` field is required from `version: 2` on, in authoritative compartments only.

## The linter

`brain-lint` ships with the hub: `node hub/tools/brain-lint.js <brain-dir>`, zero dependencies, Apache-2.0, exit 1 on errors. It enforces the frontmatter schema, provenance, dangling links, and attic lineage in authoritative compartments (global and entity `knowledge/` and `recipes/`); belief-status and freshness are warnings; episodic and working compartments (`journal/`, `meetings/`, `import/`, `projects/`, `agents/`, `daily/`) are deliberately lenient, because write-cheap is the law there. The full contract it grows into: schema per compartment · provenance coverage · link integrity · lineage completeness · belief-status transitions · debrief-grammar checks on STATE.md · freshness warnings. Lint status is part of a brain's health, next to the librarian's reports.

## Interoperability

Two-way, by design. Outbound: a Bureau brain is readable by any markdown tool, and tools that index observation/relation grammar (including Basic Memory) can index it directly; Bureau's extra fields degrade to inert metadata. Inbound: notes from other tools import into `import/` (or straight into `journal/` for small drops) as unsourced material with `belief: hypothesis`, which is precisely what an unreviewed note is; the librarian promotes what earns it. A converter ships both ways because the ownership promise requires the exit door to work.
