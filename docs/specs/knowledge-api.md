---
title: Knowledge API
compartment: spec
summary: How the hub reads, writes and commits brain files, who may write the curated compartments, how hand edits get in, and the work store for evidence.
scope: project:bureau
---

# Knowledge API

What the hub does with the brain: a folder of markdown and small attachments under git. The file format itself is `docs/brain-format.md`; this file covers the API, and the work store, where a mission's evidence lives outside the brain. Sources point at the code as of 2026-10-01 (main after #99); rules 19 and up cite functions, not lines. When they disagree with this file, the code is the fact.

## Actors

- **Agents**: anything holding the hub token, over `GET/POST /api/knowledge` and `GET/POST /api/work`.
- **MCP sessions**: chat apps on the MCP wire, writing as consul.
- **The boss**: `author: "human"` on the API, and his hands: files dropped over SFTP or edited on disk.
- **The librarian and curators**: agents holding the `librarian` or `curator` role (`missions-and-gates.md`, RULE-MISSIONS-16), the only agents that write the curated compartments.
- **The hub**: validates paths, checks who may write, commits, broadcasts, and deletes a closed mission's evidence.

## Rules

### Storage

- RULE-KNOWLEDGE-01: The brain is a git repository at `BUREAU_BRAIN_DIR` (default `hub/brain`). The hub creates and initializes it on boot when missing. (source: hub/lib/knowledge.js:7, hub/lib/knowledge.js:18-25, hub/server.js:632)
- RULE-KNOWLEDGE-02: A path is relative to the brain. Leading slashes are stripped; a `..` segment or anything under `.git` is refused. (source: hub/lib/knowledge.js:42-45, hub/lib/knowledge.js:124-128)
- RULE-KNOWLEDGE-03: Only `.md .txt .json .csv .png .jpg .jpeg .gif .svg .pdf` files are accepted. (source: hub/lib/knowledge.js:46)
- RULE-KNOWLEDGE-04: The hub does not validate content. Any text is accepted; the brain format is checked by `brain-lint`, a separate tool. (source: hub/lib/knowledge.js:50-73, docs/brain-format.md "The linter")

### Writing

- RULE-KNOWLEDGE-05: `POST /api/knowledge` needs `file` and `content`, and answers 400 without them. (source: hub/server.js:455-457)
- RULE-KNOWLEDGE-06: Mode `replace` is the default. Mode `append` adds the content at the end, with a newline first when the file is not empty. Missing folders are created. (source: hub/lib/knowledge.js:53, hub/lib/knowledge.js:59-63)
- RULE-KNOWLEDGE-07: With `encoding: "base64"` the content is decoded and written as bytes, replace only, 5MB at most after decoding. (source: hub/lib/knowledge.js:41, hub/lib/knowledge.js:54-58)
- RULE-KNOWLEDGE-08: Every write is its own git commit, authored by the `author` given (default `agent`), with the `message` given (default `update <file>`). Writing identical content is not an error. (source: hub/lib/knowledge.js:64-71)
- RULE-KNOWLEDGE-09: Every write is broadcast as `knowledge.written` with the file and the author. (source: hub/server.js:458-459)
- RULE-KNOWLEDGE-10: On MCP, `write_knowledge` always commits as author `consul`. (source: hub/server.js:550-553)

### Reading

- RULE-KNOWLEDGE-11: `GET /api/knowledge?file=` answers `{file, content}` for text and `{file, content_base64}` for binaries, 404 when the file does not exist. Binaries are `.png .jpg .jpeg .gif .pdf`; `.svg` reads as text. (source: hub/server.js:468-482, hub/lib/knowledge.js:40)
- RULE-KNOWLEDGE-12: Adding `raw=1` returns the bytes with their content type. (source: hub/server.js:475-478, hub/lib/knowledge.js:101-107)
- RULE-KNOWLEDGE-13: `GET /api/knowledge` without `file` lists every file under the brain, or under `dir` when given, recursively, skipping `.git`. (source: hub/server.js:483, hub/lib/knowledge.js:109-122)
- RULE-KNOWLEDGE-14: The 15 latest brain commits ride along in `GET /api/state`. (source: hub/server.js:291, hub/lib/knowledge.js:144-153)

### Hand edits and renames

- RULE-KNOWLEDGE-15: Files changed on disk outside the API are committed as author `human` by the intake sweep: at boot, every 5 minutes, and on `POST /api/knowledge/sweep`. (source: hub/lib/knowledge.js:85-98, hub/server.js:463-467, hub/server.js:614-621, hub/server.js:633)
- RULE-KNOWLEDGE-16: Renaming a project id moves `projects/<from>` to `projects/<to>` with `git mv`, so history follows. The rename is refused when the target folder exists. (source: hub/lib/knowledge.js:132-142, hub/server.js:401-411)
- RULE-KNOWLEDGE-17: Deleting a project never touches its brain folder. (source: hub/lib/store.js:352-361)

### First commit

- RULE-KNOWLEDGE-18: A brain with no commits gets an empty root commit, `brain created`, by `Bureau <hub@bureau.local>`, before any write, read of history, list, sweep or rename. It is built with `git commit-tree`, so files already staged in an existing empty repo stay staged and are not swept into it. The check runs once per process. (source: hub/lib/knowledge.js:13-35)

### Curated compartments

- RULE-KNOWLEDGE-19: The curated compartments are `knowledge/`, `recipes/`, `entities/<slug>/knowledge/`, `entities/<slug>/recipes/`, `entities/<slug>/PROFILE.md` and `attic/`. A path is judged after normalization, where the write would land, and without regard to case. Every other path is open. (source: hub/lib/knowledge.js curatedCompartment())
- RULE-KNOWLEDGE-20: `POST /api/knowledge` to a curated compartment is accepted only when `author` is `human`, or an agent holding the `librarian` or `curator` role (RULE-MISSIONS-16). A missing author counts as `agent` and is refused. (source: hub/server.js knowledgeWriteRefusal(), hub/lib/store.js canCurate())
- RULE-KNOWLEDGE-21: A refused write answers 403 with the compartment and who may write it, and is checked before anything else: no file is written, nothing is committed or broadcast. (source: hub/server.js POST /api/knowledge route, knowledgeWriteRefusal())
- RULE-KNOWLEDGE-22: MCP `write_knowledge` meets the same wall as consul: it writes a curated compartment only when consul holds `librarian` or `curator`; otherwise it returns an error result and writes nothing. No agent name is exempt. (source: hub/server.js mcpToolCall() write_knowledge)
- RULE-KNOWLEDGE-31: The one door through the wall without a curating role is applying an approved item (RULE-MISSIONS-35): the boss approved that exact payload and the hub checks its hash before writing, so the write goes through `writeKnowledge` authored by the applying agent without the compartment check. (source: hub/server.js applyApproved())

### The work store

- RULE-KNOWLEDGE-23: The work store is a plain folder at `BUREAU_WORK_DIR` (default `hub/work`), outside the brain: no git, no commit, no broadcast, no lint, no author. (source: hub/lib/work.js:15, hub/lib/work.js writeWork())
- RULE-KNOWLEDGE-24: A work path is `work/<t-id>/<name>`. A `..` segment anywhere is refused before normalizing, and the file types are the brain's (RULE-KNOWLEDGE-03). Anything else answers 400. (source: hub/lib/work.js parse())
- RULE-KNOWLEDGE-25: `POST /api/work` takes `file` and `content`, with `mode` and `encoding` as in RULE-KNOWLEDGE-06 and RULE-KNOWLEDGE-07 (append, base64 replace only, 5MB cap). The mission must exist (404 otherwise) and must not be `done`, `failed` or `discarded` (409). The curated-compartment wall does not apply. (source: hub/server.js workWriteRefusal(), POST /api/work route)
- RULE-KNOWLEDGE-26: `GET /api/work?file=` answers like RULE-KNOWLEDGE-11 and RULE-KNOWLEDGE-12 (`content`, `content_base64`, or bytes with `raw=1`), 404 when missing. Without `file` it lists every work file, or one mission's with `task=<t-id>`, as `work/<t-id>/...` paths. (source: hub/server.js GET /api/work route, hub/lib/work.js listWork())
- RULE-KNOWLEDGE-27: When a mission's status becomes `done`, `failed` or `discarded`, its `work/<t-id>/` folder is deleted whole. This runs inside the mission update itself, so every door that closes a mission does it: PATCH, MCP `update_mission`, a review link. A removal error is logged and never undoes the close. (source: hub/lib/store.js updateTask(), hub/lib/work.js removeMission())
- RULE-KNOWLEDGE-28: At boot, folders under the work store whose mission is closed or unknown are deleted. (source: hub/lib/store.js init(), hub/lib/work.js sweep())
- RULE-KNOWLEDGE-29: On MCP, `write_work` and `read_work` mirror `POST` and `GET /api/work` with the same checks. (source: hub/server.js mcpToolCall() write_work, read_work)
- RULE-KNOWLEDGE-30: An artifact URL that names a work image (`work/<t-id>/x.png`) renders in the dashboards from `/api/work` instead of `/api/knowledge`. Review links follow RULE-REVIEW-19. (source: hub/public/index.html, hub/public/v2/media.js, hub/public/v2/peek-panel.js, hub/public/v2/awaiting-merge.js)

## Journeys

1. **A debrief.** A worker appends three labeled parts to `projects/<p>/STATE.md` with mode `append` (RULE-KNOWLEDGE-06). The hub commits under the worker's name (RULE-KNOWLEDGE-08) and the dashboard feed shows the write (RULE-KNOWLEDGE-09).
2. **A reference image.** The boss's agent posts a PNG in base64 to `projects/<p>/references/` (RULE-KNOWLEDGE-07). Builders read it back with `raw=1` (RULE-KNOWLEDGE-12).
3. **A hand edit.** The boss fixes a recipe over SFTP. Within 5 minutes it is a commit by `human`, and every reader sees it (RULE-KNOWLEDGE-15).
4. **A fresh install.** The hub boots on an empty folder: it creates the repo and its root commit, so `GET /api/state` shows `brain created` instead of a git error (RULE-KNOWLEDGE-01, RULE-KNOWLEDGE-18, RULE-KNOWLEDGE-14).
5. **A worker learns something general.** It may not write `knowledge/` (RULE-KNOWLEDGE-20), so it appends a line to `journal/` (open). The librarian proposes the note as a review item, the boss approves, and the librarian writes it (RULE-KNOWLEDGE-20).
6. **Pair mode.** The boss gave consul the `curator` role. In a chat, he tells consul to file a recipe; consul writes `recipes/` over MCP and the commit is consul's (RULE-KNOWLEDGE-22, RULE-KNOWLEDGE-10).
7. **Evidence for a round.** A builder posts screenshots to `work/t-12/` (RULE-KNOWLEDGE-25), cites one as an artifact and parks the mission. The critic and the boss see them on the review page (RULE-REVIEW-19). The boss approves: the mission is `done` and the folder is gone (RULE-KNOWLEDGE-27).

## Edge cases

- A path with `..` or a `.exe` file: refused with an error, nothing written (RULE-KNOWLEDGE-02, RULE-KNOWLEDGE-03).
- Appending in base64: refused (RULE-KNOWLEDGE-07).
- A malformed note (no frontmatter, unsourced claims): accepted and committed. Only lint catches it (RULE-KNOWLEDGE-04).
- Reading a missing file: 404 on HTTP, an error result on MCP (RULE-KNOWLEDGE-11, hub/server.js:557-558).
- An existing repo with no commits and files already staged: the root commit is empty and the staged files wait for the next commit (RULE-KNOWLEDGE-18).
- `journal/../knowledge/x.md` or `Knowledge/x.md` from a plain agent: 403, judged as `knowledge/` (RULE-KNOWLEDGE-19, RULE-KNOWLEDGE-21).
- The librarian's tag after the boss configured roles in settings without giving it `librarian`: its writes to `knowledge/` are refused (RULE-KNOWLEDGE-20, RULE-MISSIONS-16).
- A file dropped by hand into `knowledge/`: committed by the intake sweep as `human`; the wall is on the API only (RULE-KNOWLEDGE-15).
- Evidence posted to a mission that just closed: 409, nothing written (RULE-KNOWLEDGE-25).
- A mission reopened after `done`: its evidence is already gone; the work store starts empty (RULE-KNOWLEDGE-27).
- The hub crashed between a close and the removal: the folder goes at the next boot (RULE-KNOWLEDGE-28).
