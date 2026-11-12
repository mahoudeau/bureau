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
4. Pull the new code: `git pull` (or check out the release tag, e.g. `git checkout v0.4.0`).
5. Read the release's entry in `CHANGELOG.md`, for new settings in particular.
6. Start the hub: `node hub/server.js` (it reads `hub/.env` itself), or restart it the way your host does. `sh hub/start.sh` still works.
7. Check the log and `/api/health`. The version is the new one; `schema_version` is the one this release expects.

No `npm install`, ever. The hub has no dependencies.

## 0.4.0: the new dashboard

One dashboard replaces the two old ones. The API, the agents, the review links and the office's own URL don't change.

**What moves.**

- `/` is the Desk: what needs you, what's in flight, your messages, the office in a window.
- A mission, a goal, a project and a brain note are each a page with a URL (`/missions/t-42`, `/brain/knowledge/x.md`). The side panels are gone.
- Projects moved to `/projects`. Approval, roles and agent tokens are at `/settings`.
- Static files are served from `/app/` and `/omako-ds/`. If you put a cache or a path rule in front of the hub, check that those two reach it.

**Old links redirect.** `/v2` and `/v2/styleguide` answer 301 to `/`, and `/index.html` serves the Desk. A browser keeps the `#token=` fragment across the redirect. A link that pointed inside the old dashboard lands on the Desk.

**Reload open tabs.** A tab still showing the old dashboard keeps asking for files that are gone. The token stays in the browser, so you don't sign in again.

**Themes.** The dashboard has system, paper and ink. The four Game Boy palettes belong to the office: it starts in grey, and you pick another in Settings, Appearance, or with P in the office. A theme you picked in the old dashboard isn't carried over.

**Review links load one script.** `/r/`, `/m/` and the HTML 404 now allow the hub's own scripts and nothing else (`script-src 'self'`, no inline script), to draw the dither. They work the same without it.

## 0.3.0 behind a platform proxy

0.3.0 changed where the hub listens and which browser origins it answers. Behind a platform proxy, get these right before the new code runs. Getting them wrong means a site that answers 502, or a dashboard that gets 403 on every write, and nothing in the repo can see your server's settings for you. Below, `hub.example.com` stands for your hub's public name.

**What the hub now does.** With no `HOST` and no `IP` in its environment or `hub/.env`, the hub binds `127.0.0.1` (it used to bind `::`). A platform that injects `IP` is unaffected: `hub/lib/env.js` gives an injected `IP` priority over everything else, including a `HOST` line in `hub/.env`. Many Node hosts inject `IP` and `PORT`. What must be confirmed on the machine is that the running hub actually receives them.

**Do these checks on the server, while the old code is still running.**

1. Find the hub's process and read what the platform really passes it (Linux; this prints no secrets):

   ```
   ps -u "$USER" -o pid,args | grep '[n]ode server.js'
   tr '\0' '\n' < /proc/<pid>/environ | grep -E '^(IP|PORT|HOST|BUREAU_PUBLIC_URL)='
   ```

   `/proc/<pid>/environ` is the environment at exec, before the hub reads `hub/.env`. You want `IP=` with the address the proxy connects to, not `127.0.0.1` or `localhost`, and a `PORT=`.

2. Make the bind and the public name explicit in `hub/.env` either way. Add these two lines, or the same two in the site's Environment. Both are safe on the old code too, and an injected `IP` still wins over `HOST`:

   ```
   HOST=::
   BUREAU_PUBLIC_URL=https://hub.example.com
   ```

   `HOST=::` is the bind the old default used, so a host that injects nothing is no worse off than before. If the IP check above shows no `IP`, this line is what keeps the site up; do not deploy without it. `BUREAU_PUBLIC_URL` is what lets the origin check recognise the dashboard: a browser sends `Origin: https://hub.example.com`, and behind a proxy the `Host` the hub sees can be an internal address. With it set the dashboard's POSTs and SSE tickets pass whatever the proxy forwards. Without it, and with no `X-Forwarded-Host`, every dashboard write answers 403. Check it is not already there with a different value (`grep '^BUREAU_PUBLIC_URL=' hub/.env`). It also fills in review links and MCP URLs.

3. Confirm the tokens the new boot refusal will read: `BUREAU_TOKEN` is real, not a placeholder. `grep -c '^BUREAU_TOKEN=change-me' hub/.env` prints `0`. The hub exits at boot otherwise, and behind most platform proxies a site that exits at boot answers 502.

**After the deploy, in order:**

```
curl -s https://hub.example.com/health
curl -s -H "Authorization: Bearer $BUREAU_TOKEN" https://hub.example.com/api/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Origin: https://hub.example.com" -H "Authorization: Bearer $BUREAU_TOKEN" https://hub.example.com/api/events/ticket
```

The first answers `ok`, the second shows `auth: "legacy"` and the new `version`, the third prints `200` (a `403` here is the origin check refusing the public name: fix `BUREAU_PUBLIC_URL` and restart).

### The upgrade order on a live hub

Each step leaves everything working. Nothing below ever needs two things to change at the same moment. Connectors use the `Authorization` header, so removing `?token=` touches them not at all (`hub.sh`, `connectors/claude-code/context-hook.js`, `hub/tools/token.js`). The only thing that used `?token=` was the dashboard's own URL, which reads the token out of the fragment now.

1. **Roles and approval policy in settings, on the old code.** Step 1 of the next section. A worker that closes its own boss-gate work should keep working after step 3 below.
2. **The `hub/.env` lines above, on the old code.** No restart required yet.
3. **Deploy 0.3.0 or later with only `BUREAU_TOKEN` set.** Legacy mode: identities are still declared, the hub warns at boot. The Claude Code hook, `hub.sh`, the MCP connector URLs on claude.ai and cowork routines all carry on untouched, on the same credential. Run the three checks above. Reload open dashboard tabs: the old page asks for an event stream with the token in the URL, which is gone.
4. **Set `BUREAU_BOSS_TOKEN`, restart, sign the dashboard in with it.** `/api/health` says `strict`. Every agent credential still works as before and now acts as an agent: shared-token clients on every project (the hook, `hub.sh`, routines), the old MCP URL as `consul`. The dashboard's writes need the boss token, so sign in right after the restart. On a phone or a second browser, sign in there too.
5. **Mint and swap one agent at a time**, as in step 4 of the next section: the `~/.bureau-token` of each Claude Code machine (hook and `hub.sh` read the same file), each connector on claude.ai, each scheduled routine's token. Do a chat connector or routine one at a time, and check the next run lands before moving on. Behind a platform that injects `PORT`, set `BUREAU_URL=https://hub.example.com` for `node hub/tools/token.js`: the platform's `PORT` is not what `hub/.env` says. A single agent that breaks is one token to fix; the rest stay on the shared token.
6. **Retire the shared credentials last**, step 5 of the next section. This is the only step that can lock anything out, and you do it only when nothing has used them.

To go back at any point: unset `BUREAU_BOSS_TOKEN` and restart. To go back further, run the previous code; the state file is unchanged and it ignores the fields it does not know.

## Upgrading to strict mode

Identity has changed. The hub now has two modes. **Legacy** (only `BUREAU_TOKEN` set): one shared token, declared identities, as before, with the new gate rules but no walls, since anyone with the token can declare itself the boss. **Strict** (`BUREAU_BOSS_TOKEN` set): only that token acts as the boss. `/api/health` reports which one is running as `auth`.

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
     -d '{"agents":{"consul":{"roles":["critic","lead"]},"sol":{"roles":["librarian"]}},"projects":{"general":{"approval":"in-session"}}}'
   ```

2. **Deploy this version, with only `BUREAU_TOKEN` set.** The hub runs legacy: it warns at boot, `/api/health` says `auth: "legacy"`. `hub.sh`, the context hook, cowork routines and the old MCP URL behave as before, plus the new gate rules. Check that a mission flow you rely on still closes.

3. **Turn on strict: set `BUREAU_BOSS_TOKEN`** (a new random string, not `BUREAU_TOKEN`: the hub refuses to boot if they match) and restart. `/api/health` with it answers `auth: "strict"`. Now:
   - **Sign the dashboard and office in with the boss token.** Anything that declares `agent: "human"` with the shared token is refused 403; approvals, settings, and new projects in the dashboard need the boss token. Clear `bureau_token` in the browser, or the dashboard stays on the shared token and its buttons answer 403.
   - `hub.sh`, the hook, routines and the old MCP URL keep working: the shared token acts as an agent, any declared name except `human` and `system`, on every project. The old MCP URL acts as `consul`.
   - Live routines or scripts that declare `agent: "human"` or `author: "human"` with the shared token now get 403, so give them the boss token or change them. Registered role tags stop counting (step 1).

4. **Mint a token per agent, one at a time**, and swap it in:

   ```
   node hub/tools/token.js mint consul general            # prints the token and its MCP URL, once
   node hub/tools/token.js mint sol '*'                   # the librarian reads every project
   ```

   Run it on the hub's machine (it reads `BUREAU_BOSS_TOKEN` from `hub/.env`), or set `BUREAU_URL` and `BUREAU_BOSS_TOKEN` in the environment. Put the token in that agent's `~/.bureau-token` (or its `{{BUREAU_TOKEN}}` in a cowork routine). `hub.sh` and the context hook read the same file; a hook whose agent is not `consul` needs `BUREAU_AGENT` set. For a chat connector, replace the URL with the token's `mcp_url` (same connector, new URL). List `general` too if the agent files `Propose project:` missions. An agent token that declares another name gets 403: fix the agent's name, not the check.

5. **Retire the shared credentials** when `node hub/tools/token.js list` shows every agent's token in use and `shared_token_last_used` has gone quiet (it resets at restart). `DELETE /api/mcp` with the boss token retires the old MCP URL. Remove `BUREAU_TOKEN` from the environment (`docker-compose.yml` still requires one to be set; give it a value nobody holds) and restart. Anything still sending it then answers 401.

**Roll back.** Unset `BUREAU_BOSS_TOKEN` and restart: back in legacy, with the shared token. Tokens stay in `state.json` and work again if you turn strict back on, unless revoked. No schema changed: the same `state.json` runs the older code, which ignores the fields it doesn't know.

## 0.3.0, the security release: what to check first

These change what a running hub accepts. Check them before you restart.

1. **A real token is required.** With neither `BUREAU_TOKEN` nor `BUREAU_BOSS_TOKEN` set, a placeholder from `.env.example` in either, or the two set to the same value, the hub prints why and exits. Strict mode with no `BUREAU_TOKEN` is fine: that is the end of the upgrade above. Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. For a demo on one machine only, `BUREAU_ALLOW_INSECURE_LOCAL=1` starts it anyway, and it refuses any bind that is not loopback.
2. **The default bind is `127.0.0.1`**, not all interfaces. A host that injects `IP` is unaffected, and so is the Docker image, which sets `HOST=0.0.0.0`. Anything else that reaches the hub from another machine needs `HOST=0.0.0.0` (or `HOST=::`) in `hub/.env`. Behind a platform proxy, see **0.3.0 behind a platform proxy**.
3. **CORS is no longer `*`.** Same-origin pages work as before. A page on another origin needs `BUREAU_ALLOWED_ORIGINS=https://that.example`, comma-separated. Behind a reverse proxy that rewrites `Host`, set `BUREAU_PUBLIC_URL` so the hub knows its own name, or dashboard writes and SSE tickets answer 403.
4. **`?token=` is gone.** Any script calling the API with it must send `Authorization: Bearer <token>` instead. Dashboard links that carried the token use the fragment now: `/#token=...`.
5. **The data folder is private.** At every boot the hub sets it to `0700` and the files in it to `0600` (POSIX only). A backup job reading it as another user needs to run as the hub's user.
6. **The intake sweep leaves out names the path guard refuses** (a `.git` segment at any depth, Windows-reserved names). They stay on disk, named once in the log, until you rename them.

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
