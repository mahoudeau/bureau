# claude-code connector

Glue for local coding sessions (Claude Code or any agent with a shell) working the Bureau as the boss's envoy. Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## What exists

- **`hub.sh`**: one authenticated hub call: `sh hub.sh METHOD PATH [JSON]`. Reads the hub URL from `BUREAU_URL` (default your deployment) and the token from `BUREAU_TOKEN_FILE` (default `~/.bureau-token`). The point of routing every call through one script is the permission model below.
- **`project-of.sh`**: resolves which Bureau project a directory belongs to. Resolution order: a `.bureau` marker file at the git root (its content is the project id), then a map file (`~/.bureau-projects`, lines of `path prefix = project id`, longest prefix wins), then `unresolved`, at which point the agent decides once against the hub's registry and records the decision with `project-of.sh set <dir> <id>`. Decisions are stored, announced in the mission's first note, and corrected by editing one line.

## Install, promptless

The goal: the agent files missions, notes, and debriefs silently, while consequential actions (deploys, commits) keep their permission prompts.

1. **Token**: put your hub token in `~/.bureau-token`, `chmod 600`.
2. **Scripts**: keep this directory in a stable path (a clone of the bureau repo works).
3. **Allowlist** in Claude Code's user settings (`~/.claude/settings.json`), adjusting paths:

```json
{
  "permissions": {
    "allow": [
      "Monitor",
      "Bash(sh /path/to/bureau/connectors/claude-code/hub.sh:*)",
      "Bash(sh /path/to/bureau/connectors/claude-code/project-of.sh:*)"
    ]
  }
}
```

`Monitor` lets the agent watch a blocked mission and resume the moment you answer from your phone.

4. **Convention** in your global `CLAUDE.md` (the envoy's default name is consul; rename if you like):

> For any substantive work: resolve the project (`project-of.sh get`; if unresolved, decide once against the hub registry and record it), open a mission before starting (`hub.sh POST /api/tasks`), claim it, and before working read the scope chain via `/api/knowledge`: global `knowledge/` and `recipes/`, then the project's entity if it has one (`entities/<slug>/PROFILE.md` plus its `knowledge/` and `recipes/`), then `projects/<project>/STATE.md`. Nearest scope wins; never read another entity's tree. Post progress notes, and before closing append a debrief to `projects/<project>/STATE.md`, three labeled parts: what changed, what was learned, next step. File learnings at the scope where they are true; when unsure, file lower and let the librarian promote. Close `done`, or `review` when the boss should sign off. At session start, continue any queued mission reserved for the envoy first. When blocking on the boss mid-session, arm a watcher so the answer resumes the work.

### Gotchas that cost us an evening

- Permission rules match the **beginning** of the command: no variable preambles (`HUB="..."` breaks the match), one hub call per command.
- **Every pipeline segment is checked**: parse responses with an allowlisted tool (`jq`), not an interpreter that will prompt.

## Planned

The packaged form of all of this: a Claude Code plugin with a one-command installer, hooks (register on session start, heartbeats with activity verbs, a debrief nudge before context compaction), and skills for clock-in and debrief. The manual setup above is the plugin's specification in the meantime.
