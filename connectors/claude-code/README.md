# claude-code connector

Glue for local coding sessions (Claude Code or any agent with a shell) working the Bureau as the boss's envoy. Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## What exists

- **`project-of.sh`**: resolves which Bureau project a directory belongs to. Resolution order: a `.bureau` marker file at the git root (its content is the project id), then a map file (`~/.bureau-projects`, lines of `path prefix = project id`, longest prefix wins), then `unresolved`, at which point the agent decides once against the hub's registry and records the decision with `project-of.sh set <dir> <id>`. Decisions are stored, announced in the mission's first note, and corrected by editing one line.

The working convention it supports: resolve the project, open a mission before substantive work, claim it, post progress notes, debrief to `projects/<project>/STATE.md`, close done or review. One mission per work session.

## Planned

Hook script reporting activity verbs automatically (register on session start, heartbeats per tool use, a debrief nudge before compaction), and skills for clock-in and debrief. The installer pattern: marker-based idempotent edit of the local settings, atomic write.
