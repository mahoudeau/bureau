# claude-code connector

Glue for local coding sessions (Claude Code or any agent with a shell) working the Bureau as the boss's envoy. Licensed Apache-2.0 (`../../LICENSE-APACHE`).

## What exists

- **`hub.sh`**: one authenticated hub call: `sh hub.sh METHOD PATH [JSON]`. Reads the hub URL from `BUREAU_URL` or `~/.bureau-url` (no default: it refuses to guess where to send your token). The token, first found wins: your `bureau login` sign-in for that hub and `BUREAU_AGENT` (default `consul`); the file named in `BUREAU_TOKEN_FILE`, when you set it; on a Mac, the Keychain item `bureau-hub` (account: the agent); then `~/.bureau-token`. `context-hook.js` reads them in the same order, after a `BUREAU_TOKEN` set in its environment. The point of routing every call through one script is the permission model below.
- **`project-of.sh`**: resolves which Bureau project a directory belongs to. Resolution order: a `.bureau` marker file at the git root (its content is the project id), then a map file (`~/.bureau-projects`, lines of `path prefix = project id`, longest prefix wins), then `unresolved`, at which point the agent decides once against the hub's registry and records the decision with `project-of.sh set <dir> <id>`. Decisions are stored, announced in the mission's first note, and corrected by editing one line.
- **`context-hook.js`**: a Claude Code hook that makes the context call on each prompt (below).

## Prerequisites

`sh`, `curl` and `jq` for the scripts and the convention below (`jq` parses the hub's answers without a permission prompt), Node 18 or newer for `context-hook.js`, and git for `project-of.sh`.

## Install, promptless

The goal: the agent files missions, notes, and debriefs silently, while consequential actions (deploys, commits) keep their permission prompts.

1. **Address and sign-in**: put your hub's address in `~/.bureau-url` (e.g. `http://localhost:8100`). Then sign in as your agent with the CLI (`../cli/README.md`):

   ```sh
   node /path/to/bureau/connectors/cli/bureau.js login --agent consul
   ```

   Approve on the page it opens. The sign-in goes to the Keychain on a Mac and refreshes itself; `hub.sh` and the context hook pick it up. If the agent is not `consul`, set `BUREAU_AGENT` for both.

   The hub's owner allows the CLI as that agent once, on the Desk. Until then `hub.sh` gets 403 `app_pending`.

   **Fallback, a token**: on a hub without sign-in, use a minted token (`node hub/tools/token.js mint consul <projects>`), never the boss token. On a Mac, keep it in the Keychain: `security add-generic-password -s bureau-hub -a consul -w` asks for it, so it never lands in your shell history or a file. Elsewhere, put it in `~/.bureau-token`, `chmod 600`. Once you switch to `bureau login`, delete the file and the Keychain item: the sign-in wins anyway, and a long-lived token left lying around is one more thing to leak.
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

`Monitor` lets the agent watch a blocked mission and resume the moment you answer, from the dashboard on any device.

4. **Convention** in your global `CLAUDE.md` (the envoy's default name is consul; rename if you like):

> Register the envoy at session start with the same capabilities every time (`{"name":"consul","kind":"claude-code","capabilities":["critic","lead"]}` when the envoy plays critic and lead with you). A re-registration replaces the whole array, so a bare or different list drops the role tags. On a legacy hub the tags are the roles, and losing them costs the envoy the right to park boss-gate missions. On a strict hub only the roles you set in Settings count, and the tags are a label. For any substantive work: resolve the project (`project-of.sh get`; if unresolved, decide once against the hub registry and record it), open a mission before starting (`hub.sh POST /api/tasks`), claim it, and before working read the scope chain via `/api/knowledge`: global `knowledge/` and `recipes/`, then the project's entity if it has one (`entities/<slug>/PROFILE.md` plus its `knowledge/` and `recipes/`), then `projects/<project>/STATE.md`. Nearest scope wins; never read another entity's tree. Post progress notes, and before closing append a debrief to `projects/<project>/STATE.md`, three labeled parts: what changed, what was learned, next step. File learnings at the scope where they are true; when unsure, file lower and let the librarian promote. A learning for the journal is a record, not a line: `hub.sh POST /api/journal` with `{"agent":"consul","kind":"...","text":"...","evidence":"..."}`; the hub stamps the time and the mission. Close `done`, or `review` when the boss should sign off. When the boss approves the work in the session itself, close `done` straight from `in_progress` with his exact words in `approved_in_session` (if the project's policy doesn't take chat approvals, the hub says so: then park it in `review` for him); under a policy that takes the quote, never park it in `review` for a second approval. `review` is for work finished while he is away, and for irreversible steps (deploys, merges, external sends, purchases, credentials) he has not explicitly approved in the chat. At session start, continue any queued mission reserved for the envoy first, then read the envoy's inbox (`GET /api/messages?for=<envoy>`): other agents' handoffs land there and nothing else surfaces them. When blocking on the boss mid-session, arm a watcher so the answer resumes the work.

### Gotchas that cost us an evening

- Permission rules match the **beginning** of the command: no variable preambles (`HUB="..."` breaks the match), one hub call per command.
- **Every pipeline segment is checked**: parse responses with an allowlisted tool (`jq`), not an interpreter that will prompt.

## The context call on every prompt

`context-hook.js` asks the hub for passages that match each prompt and hands them to the model. It finds the project the way `project-of.sh` does and reads the hub's address from the same file. For the token it reads your `bureau login` sign-in directly. When the access token has 30 seconds or less left, it tries one refresh with a 400 ms limit; if that does not work, it uses the token file or the `bureau-hub` Keychain item, as `hub.sh` does. If the hub is slow or absent, the prompt goes through without it. Add this to `~/.claude/settings.json`, with your path:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node /path/to/bureau/connectors/claude-code/context-hook.js", "timeout": 3 }] }
    ],
    "SessionStart": [
      { "matcher": "compact", "hooks": [{ "type": "command", "command": "node /path/to/bureau/connectors/claude-code/context-hook.js", "timeout": 3 }] }
    ]
  }
}
```

The hub sends a passage once per session. A compaction drops those passages from the model's context, so the `SessionStart` entry tells the hub to forget what it sent, and the next prompt can get them again. Claude Code reports a compaction, manual or automatic, as `SessionStart` with `source: "compact"` and the same `session_id`. The hook ignores the other sources: a resumed session still holds its passages, and `/clear` starts under a new session id. Without this entry nothing breaks, but a passage already sent stays held back for 12 hours.

**Headless.** Both hooks run under `claude -p` (checked on 2.1.285), so a scripted run gets the same context as a terminal session, as long as it loads the settings that hold them. `--bare` and `--safe-mode` skip hooks, and `--setting-sources` without `user` skips hooks in `~/.claude/settings.json`. A local command such as `/compact` is not a prompt and does not fire `UserPromptSubmit`.

Failures go to `~/.bureau-context-hook.log`.

## Planned

Not built yet: a Claude Code plugin with a one-command installer, more hooks (register on session start, heartbeats with activity verbs, a debrief nudge before context compaction), and skills for clock-in and debrief. The context hook above is the only hook that ships today.
