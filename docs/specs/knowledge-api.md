---
title: Knowledge API
summary: How the hub reads, writes, lists and commits brain files, which paths and types it accepts, and how hand edits get in.
scope: project:bureau
---

# Knowledge API

What the hub does with the brain: a folder of markdown and small attachments under git. The file format itself is `docs/brain-format.md`; this file covers the API. Sources point at the code as of this writing; when they disagree with this file, the code is the fact.

## Actors

- **Agents**: anything holding the hub token, over `GET/POST /api/knowledge`.
- **MCP sessions**: chat apps on the MCP wire, writing as consul.
- **The boss's hands**: files dropped over SFTP or edited on disk.
- **The hub**: validates paths, commits, broadcasts.

## Rules

### Storage

- RULE-KNOWLEDGE-01: The brain is a git repository at `BUREAU_BRAIN_DIR` (default `hub/brain`). The hub creates and initializes it on boot when missing. (source: hub/lib/knowledge.js:7, hub/lib/knowledge.js:13-20, hub/server.js:598)
- RULE-KNOWLEDGE-02: A path is relative to the brain. Leading slashes are stripped; a `..` segment or anything under `.git` is refused. (source: hub/lib/knowledge.js:27-30)
- RULE-KNOWLEDGE-03: Only `.md .txt .json .csv .png .jpg .jpeg .gif .svg .pdf` files are accepted. (source: hub/lib/knowledge.js:31)
- RULE-KNOWLEDGE-04: The hub does not validate content. Any text is accepted; the brain format is checked by `brain-lint`, a separate tool. (source: hub/lib/knowledge.js:35-58, docs/brain-format.md "The linter")

### Writing

- RULE-KNOWLEDGE-05: `POST /api/knowledge` needs `file` and `content`, and answers 400 without them. (source: hub/server.js:428-430)
- RULE-KNOWLEDGE-06: Mode `replace` is the default. Mode `append` adds the content at the end, with a newline first when the file is not empty. Missing folders are created. (source: hub/lib/knowledge.js:38, hub/lib/knowledge.js:44-48)
- RULE-KNOWLEDGE-07: With `encoding: "base64"` the content is decoded and written as bytes, replace only, 5MB at most after decoding. (source: hub/lib/knowledge.js:26, hub/lib/knowledge.js:39-43)
- RULE-KNOWLEDGE-08: Every write is its own git commit, authored by the `author` given (default `agent`), with the `message` given (default `update <file>`). Writing identical content is not an error. (source: hub/lib/knowledge.js:49-56)
- RULE-KNOWLEDGE-09: Every write is broadcast as `knowledge.written` with the file and the author. (source: hub/server.js:431-432)
- RULE-KNOWLEDGE-10: On MCP, `write_knowledge` always commits as author `consul`. (source: hub/server.js:523-526)

### Reading

- RULE-KNOWLEDGE-11: `GET /api/knowledge?file=` answers `{file, content}` for text and `{file, content_base64}` for binaries, 404 when the file does not exist. Binaries are `.png .jpg .jpeg .gif .pdf`; `.svg` reads as text. (source: hub/server.js:441-455, hub/lib/knowledge.js:25)
- RULE-KNOWLEDGE-12: Adding `raw=1` returns the bytes with their content type. (source: hub/server.js:448-451, hub/lib/knowledge.js:86-92)
- RULE-KNOWLEDGE-13: `GET /api/knowledge` without `file` lists every file under the brain, or under `dir` when given, recursively, skipping `.git`. (source: hub/server.js:456, hub/lib/knowledge.js:94-107)
- RULE-KNOWLEDGE-14: The 15 latest brain commits ride along in `GET /api/state`. (source: hub/server.js:277, hub/lib/knowledge.js:129-138)

### Hand edits and renames

- RULE-KNOWLEDGE-15: Files changed on disk outside the API are committed as author `human` by the intake sweep: at boot, every 5 minutes, and on `POST /api/knowledge/sweep`. (source: hub/lib/knowledge.js:70-83, hub/server.js:436-440, hub/server.js:589-599)
- RULE-KNOWLEDGE-16: Renaming a project id moves `projects/<from>` to `projects/<to>` with `git mv`, so history follows. The rename is refused when the target folder exists. (source: hub/lib/knowledge.js:117-127, hub/server.js:374-384)
- RULE-KNOWLEDGE-17: Deleting a project never touches its brain folder. (source: hub/lib/store.js:235)

## Journeys

1. **A debrief.** A worker appends three labeled parts to `projects/<p>/STATE.md` with mode `append` (RULE-KNOWLEDGE-06). The hub commits under the worker's name (RULE-KNOWLEDGE-08) and the dashboard feed shows the write (RULE-KNOWLEDGE-09).
2. **A reference image.** The boss's agent posts a PNG in base64 to `projects/<p>/references/` (RULE-KNOWLEDGE-07). Builders read it back with `raw=1` (RULE-KNOWLEDGE-12).
3. **A hand edit.** The boss fixes a recipe over SFTP. Within 5 minutes it is a commit by `human`, and every reader sees it (RULE-KNOWLEDGE-15).

## Edge cases

- A path with `..` or a `.exe` file: refused with an error, nothing written (RULE-KNOWLEDGE-02, RULE-KNOWLEDGE-03).
- Appending in base64: refused (RULE-KNOWLEDGE-07).
- A malformed note (no frontmatter, unsourced claims): accepted and committed. Only lint catches it (RULE-KNOWLEDGE-04).
- Reading a missing file: 404 on HTTP, an error result on MCP (RULE-KNOWLEDGE-11, hub/server.js:529-531).
