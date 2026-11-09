# Upgrading Bureau

For self-hosters. What changed in each release is in [CHANGELOG.md](CHANGELOG.md); this file is how to move between them safely.

## Where your data lives

- `hub/data/state.json`: missions, roster, messages, projects (or `BUREAU_DATA_DIR`).
- `hub/brain/`: the knowledge brain, a git repo (or `BUREAU_BRAIN_DIR`).
- `hub/work/`: the work store, open missions' evidence (or `BUREAU_WORK_DIR`; `/data/work` in the Docker image). Disposable by design: each folder is deleted when its mission closes.

The brain has its own history in git. The state file is what the steps below protect.

## Upgrade

1. Check the running version: `curl https://your-hub/api/health -H "Authorization: Bearer $TOKEN"` shows `version` and `schema_version`.
2. Stop the hub. A clean stop (SIGTERM or SIGINT; Ctrl-C or closing the window on Windows) writes any pending change and releases `data/hub.lock`.
3. Copy the state aside yourself, whatever the hub does for you: `cp hub/data/state.json hub/data/state.json.manual-<date>`.
4. Pull the new code: `git pull` (or check out the release tag, e.g. `git checkout v0.2.0`).
5. Read the release's entry in `CHANGELOG.md`, for new settings in particular.
6. Start the hub: `node hub/server.js` (it reads `hub/.env` itself), or restart it the way your host does. `sh hub/start.sh` still works.
7. Check the log and `/api/health`. The version is the new one; `schema_version` is the one this release expects.

No `npm install`, ever. The hub has no dependencies.

## Upgrading to strict mode

Identity has changed. The hub now has two modes. **Legacy** (only `BUREAU_TOKEN` set): one shared token, declared identities, as before, with the new gate rules. **Strict** (`BUREAU_BOSS_TOKEN` set): only that token acts as the boss. `/api/health` reports which one is running as `auth`.

The upgrade is a sequence, not a flag day. After each step, everything that worked before still works, except where noted. No step locks you out: if you set the boss token wrongly, unset it and restart, and you are back in legacy.

**Before anything, know what the new gate refuses, even in legacy.** With no approval policy set, an agent can no longer close a `gate: boss` mission `done`. If a project relies on agents closing their own boss-gate work, set its policy *first*, while still on the old code:

```
curl -X PATCH https://your-hub/api/settings -H "Authorization: Bearer $BUREAU_TOKEN" -H "Content-Type: application/json" \
  -d '{"projects":{"<project>":{"approval":"in-session"}}}'
```

and make sure pair-mode agents carry the boss's words in `approved_in_session`. Under `approval: dashboard` or unset, an agent's close is refused and the mission must be parked in `review` (by a critic or lead) for you to close, so check that your standing prompts don't tell them to close `done` with the note form `approved by boss in session: "..."`: that note no longer closes anything unless the policy is `in-session`. Your critic and lead need their roles in settings too (next step), or they can no longer park work.

1. **Set roles and policy in settings, on the old code or new legacy.** Strict mode reads roles from settings only: the capability tags an agent registers grant nothing there. `GET /api/settings` to see what is set; `PATCH` to give every lead, critic, librarian and curator its role, and every project its `approval`. Do this first, so nothing changes when strict turns on.

   ```
   curl -X PATCH https://your-hub/api/settings -H "Authorization: Bearer $BUREAU_TOKEN" -H "Content-Type: application/json" \
     -d '{"agents":{"consul":{"roles":["critic","lead"]},"sol":{"roles":["librarian"]}},"projects":{"bureau":{"approval":"in-session"}}}'
   ```

2. **Deploy this version, with only `BUREAU_TOKEN` set.** The hub runs legacy: it warns at boot, `/api/health` says `auth: "legacy"`. `hub.sh`, the context hook, cowork routines and the old MCP URL behave as before, plus the new gate rules. Check that a mission flow you rely on still closes.

3. **Turn on strict: set `BUREAU_BOSS_TOKEN`** (a new random string, not `BUREAU_TOKEN`: the hub refuses to boot if they match) and restart. `/api/health` with it answers `auth: "strict"`. Now:
   - **Sign the dashboard and office in with the boss token.** Anything that declares `agent: "human"` with the shared token is refused 403; approvals, settings, and new projects in the dashboard need the boss token. Clear `bureau_token` in the browser, or the dashboard stays on the shared token and its buttons answer 403.
   - `hub.sh`, the hook, routines and the old MCP URL keep working: the shared token acts as an agent, any declared name except `human` and `system`, on every project. The old MCP URL acts as `consul`.
   - Live routines or scripts that declare `agent: "human"` or `author: "human"` with the shared token now get 403, so give them the boss token or change them. Registered role tags stop counting (step 1).

4. **Mint a token per agent, one at a time**, and swap it in:

   ```
   node hub/tools/token.js mint consul bureau,general     # prints the token and its MCP URL, once
   node hub/tools/token.js mint sol '*'                   # the librarian reads every project
   ```

   Run it on the hub's machine (it reads `BUREAU_BOSS_TOKEN` from `hub/.env`), or set `BUREAU_URL` and `BUREAU_BOSS_TOKEN` in the environment. Put the token in that agent's `~/.bureau-token` (or its `{{BUREAU_TOKEN}}` in a cowork routine). `hub.sh` and the context hook read the same file; a hook whose agent is not `consul` needs `BUREAU_AGENT` set. For a chat connector, replace the URL with the token's `mcp_url` (same connector, new URL). List `general` too if the agent files `Propose project:` missions. An agent token that declares another name gets 403: fix the agent's name, not the check.

5. **Retire the shared credentials** when `node hub/tools/token.js list` shows every agent's token in use and `shared_token_last_used` has gone quiet (it resets at restart). `DELETE /api/mcp` with the boss token retires the old MCP URL. Remove `BUREAU_TOKEN` from the environment (`docker-compose.yml` still requires one to be set; give it a value nobody holds) and restart. Anything still sending it then answers 401.

**Roll back.** Unset `BUREAU_BOSS_TOKEN` and restart: back in legacy, with the shared token. Tokens stay in `state.json` and work again if you turn strict back on, unless revoked. No schema changed: the same `state.json` runs the older code, which ignores the fields it doesn't know.

## What happens on boot

The hub checks `state.json` before it listens.

- **It does not parse** (truncated write, bad hand edit, empty file): the hub refuses to start, prints why, and keeps a copy as `state.json.corrupt-<timestamp>`. It never starts on empty state in place of your data. It keeps refusing until you fix or restore the file (see Roll back).
- **It is missing but backups exist**: the hub refuses to start. Restore a backup, or move the backups away if you really mean to start fresh.
- **Another hub owns the data dir**: the second process refuses to start. A lock left by a dead process is taken over on its own.
- **Its `schema_version` is older than this release's**: the hub copies the file to `state.json.pre-migrate-<timestamp>`, runs the migrations in order, writes the result, and logs `migrating state from schema X to Y`. Missions, roster and messages carry over.
- **Its `schema_version` is newer than this release's** (you went back to older code): the hub refuses to start. Restore the matching `pre-migrate` file, or run the newer code.

### Migrations so far

| Schema | Release | What it does |
|---|---|---|
| 0 to 1 | 0.2.0 | Adds `schema_version` to the file and fills in top-level lists older files may lack (`agents`, `messages`, `log`). Nothing is removed or renamed. |

## Backups the hub keeps

In the data dir, next to `state.json`:

- `state.json.bak.1` to `state.json.bak.24`: one per hour, `.bak.1` the newest.
- `state.json.daily-YYYY-MM-DD`: the first of each UTC day, the last seven kept.
- `state.json.pre-migrate-<timestamp>`: one per migration, never deleted by the hub.
- `state.json.corrupt-<timestamp>`: a bad file set aside, never deleted by the hub.

Tune with `BUREAU_BACKUP_INTERVAL_MS` (default 3600000), `BUREAU_BACKUP_KEEP` (24) and `BUREAU_DAILY_KEEP` (7). These all sit on the same disk as the state: copy the data dir somewhere else now and then, the way you push the brain to a remote.

## Roll back

To the code and state from before an upgrade:

1. Stop the hub.
2. Check out the previous release: `git checkout v0.1.0` (or the commit you ran before).
3. Restore the state from before the migration: `cp hub/data/state.json.pre-migrate-<timestamp> hub/data/state.json`. Take the newest `pre-migrate` file whose time matches the upgrade.
4. Start the hub.

Anything written between the upgrade and the rollback is lost from the state (the brain keeps its own git history). If that matters, keep the migrated `state.json` aside before step 3.

To recover from a corrupt or bad state without changing code:

1. Stop the hub.
2. Pick the newest good backup: `state.json.bak.1`, then `.bak.2`, and so on, or a `daily-` file. `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" <file>` exits quietly on a file that parses.
3. `cp` it over `state.json` and start the hub.
