# Bureau Brain Format (v0.1, draft)

The file format for Bureau brains. Plain markdown, built from the open commons every markdown-graph tool shares: YAML frontmatter, `[[wikilinks]]`, `#tags`, categorized list items. Prior art gladly credited: Obsidian and Roam popularized wikilink graphs; [Basic Memory](https://github.com/basicmachines-co/basic-memory) showed how far observations and typed relations inside plain markdown can go. This spec uses the same commons grammar and adds a policy layer those formats do not have: provenance, belief status, freshness, and lineage, all machine-checkable.

Design rule inherited from the rest of Bureau: the format is a contract, so it ships with a validator. A brain either passes lint or it does not.

## Compartments

A brain is a git repository with five compartments. Files also self-describe via frontmatter, so a file survives being copied out of its folder.

| Path | Role | Write policy |
|---|---|---|
| `journal/` | episodic: raw, time-ordered captures | cheap; anyone writes, minimal structure |
| `knowledge/` | semantic: curated, authoritative | strict; lint enforced |
| `recipes/` | procedural: extracted how-tos | strict; lint enforced |
| `archive/` | digested raw, cold | append by the librarian |
| `attic/` | retired beliefs, with lineage | moves only, never deletes |

## Note grammar (the commons layer)

A note is markdown with YAML frontmatter. Observations are categorized list items; relations are typed wikilinks. This layer is deliberately compatible with the wider markdown-graph ecosystem: these files parse as ordinary notes in Obsidian, and tools that understand observation/relation grammar can index them unchanged.

```markdown
---
title: Deploy process for the hub
compartment: recipe
permalink: deploy-hub
version: 1
---

- [step] Push to main; CI runs the conformance script #deploy
- [step] alwaysdata restarts the Node site on git pull #deploy
- [gotcha] The IPv6 bind fails on some hosts; the server falls back to IPv4 (source: [[journal/2026-08-11]])

## Relations
- part_of [[Hub operations]]
- supersedes [[attic/recipes/deploy-hub-v0]]
```

- Observation: `- [category] statement #tags (source: [[target]])`
- Relation: `- relation_type [[Target]]`; bare wikilinks in prose are implicit relations
- `permalink`: stable identifier that survives file moves; all lineage and source links prefer permalinks

## The policy layer (Bureau extensions)

Extra frontmatter fields and grammar rules. In other tools they are inert custom metadata; in Bureau they are enforced.

**Provenance (enforced in knowledge/ and recipes/).** Every observation carries at least one `(source: [[...]])` link to journal material or a mission. An unsourced claim is a lint error, not a style issue. This is what keeps the authoritative layer free of hallucinated facts.

**Belief status.** `belief: hypothesis | validated | superseded`. Hypothesis: asserted once. Validated: confirmed by independent debriefs or human review; the promotion is an event with a source. Superseded: lives in the attic. Consumers surface it: an agent quoting a hypothesis says so.

**Earned-by.** `earned_by: [[missions/t-42]]` links a note to the reviewed work that produced it. Optional but valued: it is the difference between remembered and earned.

**Freshness.** `volatility: volatile | stable | durable` (defaults stable). Volatile facts (prices, versions, contacts) get `verified:` dates; a stale volatile fact is a lint warning and, in Bureau, a re-verification mission.

**Lineage.** Retirement moves a file to `attic/` preserving its path and stamps `retired:` (date), `retired_by:`, `retired_reason:`, `superseded_by: [[...]]`. The replacement carries `supersedes: [[...]]`. Both directions are lint-checked: no orphan retirements, no unexplained replacements.

**Versioning.** `version:` on every structured note; the spec itself is versioned so conventions can migrate without breaking old files.

## The linter

`brain-lint` (ships with the hub) checks: frontmatter schema per compartment · provenance coverage in knowledge/ and recipes/ · link integrity (no dangling wikilinks in authoritative compartments) · lineage completeness across attic/ · belief-status transitions (no validated without sources) · freshness warnings. Lint status is part of a brain's health, next to the librarian's reports.

## Interoperability

Two-way, by design. Outbound: a Bureau brain is readable by any markdown tool, and tools that index observation/relation grammar (including Basic Memory) can index it directly; Bureau's extra fields degrade to inert metadata. Inbound: notes from other tools import into `journal/` as unsourced material with `belief: hypothesis`, which is precisely what an unreviewed note is; the librarian promotes what earns it. A converter ships both ways because the ownership promise requires the exit door to work.
