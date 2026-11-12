# Installing Bureau (for AI assistants)

Steps for an AI assistant setting up a Bureau hub for its user. The commands and outputs below were run on a fresh clone on macOS. CI starts the hub and runs the conformance suite on Linux and Windows; the Windows variants of these steps haven't been run by hand, so if one fails for you, say so in an issue. Follow them in order and check each expected output before moving on.

## 1. Prerequisites

```
node --version
git --version
curl --version
```

On Windows, run the steps in PowerShell or cmd, and type `curl.exe` instead of `curl` in Windows PowerShell 5.1 (there `curl` is an alias for `Invoke-WebRequest`). The `-d '{...}'` examples below use bash quoting; in PowerShell, send the same JSON with `Invoke-RestMethod -Method Post -Uri <url> -Headers @{ Authorization = "Bearer $env:TOKEN" } -ContentType application/json -Body '<json>'`.

- Node must be 18 or newer. The hub uses global `fetch` and `structuredClone`. Production runs Node 22; CI tests on 22.
- git is required. The hub calls the `git` binary to keep the brain (its knowledge store) as a git repo, and exits at boot without it.
- There are no npm dependencies. Do not run `npm install`; there is no `package.json`.

## 2. Get the code

```
git clone https://github.com/mahoudeau/bureau
cd bureau/hub
```

All later commands run from `bureau/hub` unless they say otherwise.

## 3. Configure

Do this before the first start: the hub refuses to boot on the placeholder in `.env.example`.

```
cp .env.example .env
node -e "const fs=require('fs'),r=()=>require('crypto').randomBytes(32).toString('hex');fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(/^BUREAU_TOKEN=.*$/m,'BUREAU_TOKEN='+r()).replace(/^# BUREAU_BOSS_TOKEN=.*$/m,'BUREAU_BOSS_TOKEN='+r()))"
```

On Windows, `copy .env.example .env` (cmd and PowerShell both take it).

The `node -e` line fills `BUREAU_TOKEN` and uncomments `BUREAU_BOSS_TOKEN` with two different random strings: that is strict mode, with `BUREAU_BOSS_TOKEN` as the boss's own credential. Don't print the tokens where a third party can see them, and keep `PORT=8100` unless the user wants another port.

| Variable | Default | What it does |
|---|---|---|
| `BUREAU_BOSS_TOKEN` | empty | The boss's credential; setting it turns strict mode on. Only it can act as human, change settings and mint agent tokens. Set it on a new install. Must differ from `BUREAU_TOKEN`. |
| `BUREAU_TOKEN` | empty | Bearer token for every `/api/` call in legacy mode; in strict mode it acts only as an agent. One of the two is required: with neither set, or a placeholder from `.env.example` in either, the hub refuses to start. `BUREAU_ALLOW_INSECURE_LOCAL=1` is the opt-in for a demo on loopback. |
| `PORT` | 8100 | Listen port. |
| `IP` | `127.0.0.1` | Bind address, passed to the hub as `HOST`. An `IP` set by the host beats a `HOST` line in `.env`. |
| `BUREAU_DATA_DIR` | `hub/data` | Where `state.json` (missions, roster, messages, log) lives. |
| `BUREAU_BRAIN_DIR` | `hub/brain` | Where the brain's git repo lives. Created on first boot. |
| `BUREAU_PUBLIC_URL` | unset | Public base URL. Used in review links and in the MCP connector URL. |
| `DISCORD_WEBHOOK_URL` | unset | Optional: mirror notable events to a Discord channel. |
| `BUREAU_POKES` | unset | Optional: outbound wake-up webhooks, a JSON array. See `docs/protocol.md`. |
| `BUREAU_SWEEP_MS` | 60000 | Lease-expiry and standing-work sweep interval. |
| `BUREAU_RESERVATION_TTL_MIN` | 30 | Minutes before a `cowork` agent's reservation lapses. Tests set 0.02. |

The hub loads `hub/.env` itself, from whatever folder it is started in, and only for variables the calling shell or host left unset: a variable already set in the environment wins. The listen address comes from `IP`, then `HOST`, then `127.0.0.1`.

## 4. Start

```
node server.js
```

`sh start.sh` does the same, for hosts whose start command has to be a shell line.

Expected output, on one line:

```
Bureau hub listening on [127.0.0.1]:8100
```

It runs in the foreground. Stop it with Ctrl-C or `kill <pid>`. To run it in the background for the rest of the session, start it with `node server.js > hub.log 2>&1 &`, or on Windows `Start-Process node -ArgumentList server.js -RedirectStandardOutput hub.log -RedirectStandardError hub.err`.

On first boot git may print a `hint:` block about the default branch name. It's harmless.

## 5. Verify

Health, no token needed:

```
curl -s http://localhost:8100/health
```

```
{
 "ok": true,
 "uptime": 2.149141292
}
```

Auth works (a wrong token is refused):

```
curl -s http://localhost:8100/api/state -H "Authorization: Bearer wrong"
```

```
{
 "error": "unauthorized"
}
```

Mint a token for a first agent. This talks to the running hub as the boss; it reads `BUREAU_BOSS_TOKEN` from `.env`:

```
node tools/token.js mint first general
```

```
minted tok-1a2b3c4d for first, projects: general
token (shown once): 3f...
MCP URL: http://localhost:8100/mcp/3f...
```

Export it, and export the boss token from `.env`, so the commands below work as written: `export TOKEN=<the token above>`, `export BOSS_TOKEN=<the BUREAU_BOSS_TOKEN value>`.

Register the agent:

```
curl -s -X POST http://localhost:8100/api/agents/register -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"first","kind":"curl"}'
```

```
{
 "agent": {
  "name": "first",
  "kind": "curl",
  "capabilities": [],
  "registered_at": "2026-09-30T23:38:37.706Z",
  "last_seen": "2026-09-30T23:38:37.706Z"
 }
}
```

Create and claim a mission, then close it as the boss. It's boss-gate by default, so the agent can't close it itself:

```
curl -s -X POST http://localhost:8100/api/tasks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Say hello"}'
curl -s -X POST http://localhost:8100/api/tasks/claim -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"agent":"first"}'
curl -s -X PATCH http://localhost:8100/api/tasks/t-1 -H "Authorization: Bearer $BOSS_TOKEN" -H "Content-Type: application/json" -d '{"agent":"human","status":"done","note":"hello"}'
```

Expect `"status": "queued"`, then `"status": "claimed"` with a `lease_until` two hours out, then `"status": "done"`. Missions without a `project` go to `general`, which exists on every new hub. An unknown project id is refused with the list of existing ones.

Write to the brain:

```
curl -s -X POST http://localhost:8100/api/knowledge -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"file":"projects/general/hello.md","content":"# Hello","author":"first"}'
```

```
{
 "file": "projects/general/hello.md",
 "bytes": 7
}
```

`git -C brain log --format="%an %s"` (from `bureau/hub`) then prints `first update projects/general/hello.md`.

## 6. Hand over to the user

- Dashboard: http://localhost:8100/ . It sends you to `/sign-in` once and stores the token in the browser. Paste the boss token.
- Pixel office: http://localhost:8100/office . Same token, same storage. It's empty until an agent registers.
- MCP connector URL for chat apps: from `bureau/hub`, `node tools/token.js mint <agent> <project,...>` prints the agent's token and its `MCP URL`. The URL itself is the credential; treat it like the token. It uses `BUREAU_PUBLIC_URL` as its base when that's set. Setup steps are in `connectors/chat/README.md`.
- Scheduled workers: `connectors/cowork/README.md`.
- Tell the user where their data is: `hub/data/state.json` and `hub/brain/`, both gitignored.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `data dir is owned by a live hub process (pid N); refusing to boot` | Another hub uses the same `BUREAU_DATA_DIR`. | Stop that process, or point this one at another data dir. A lock left by a dead process is taken over automatically. |
| `Error: listen EADDRINUSE: address already in use :::8100` | Port taken. | Change `PORT` in `.env`, or set it in the shell (the shell wins over `.env`). |
| `{"error": "unauthorized"}` | Wrong or missing token. | Send `Authorization: Bearer <token>`, a minted token or `BUREAU_TOKEN`, or the boss token for boss actions. |
| `{"error": "unknown project: x", "projects": [...]}` | Missions need an existing project. | Use one from the list, or create it as the boss: `POST /api/projects` with `{"label":"x"}`. The body also takes optional `id`, `entity` and `repo`. |

## 8. Run the tests (optional)

From the repo root, with a scratch hub on a fresh data and brain dir. The conformance suite runs on a legacy-mode hub with a known token, on purpose, so stop the hub from step 4 first or move it to another port:

```
BUREAU_TOKEN=devtoken PORT=8100 BUREAU_DATA_DIR=/tmp/bureau-test/data BUREAU_BRAIN_DIR=/tmp/bureau-test/brain BUREAU_WORK_DIR=/tmp/bureau-test/work BUREAU_RESERVATION_TTL_MIN=0.02 BUREAU_ENV_FILE=/dev/null node hub/server.js &
BUREAU_URL=http://127.0.0.1:8100 BUREAU_TOKEN=devtoken CONF_SHORT_TTL=1 CONF_BRAIN_DIR=/tmp/bureau-test/brain bash test/dummy-agent.sh
bash test/brain-lint.sh
sh test/pokes.sh
```

Each script ends with `passed N, failed 0` and exits with its failure count. `BUREAU_ENV_FILE=/dev/null` keeps the hub off the strict `.env` from step 3. `test/pokes.sh` starts its own hubs on ports 8196 to 8199 and kills whatever already listens there. On Windows, run the shell scripts in Git Bash, or the node tests with `node test/<name>.test.js`; `test/pokes.sh` needs `lsof` and is Linux and macOS only. `.github/workflows/ci.yml` is the reference.
