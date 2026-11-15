# Installing Bureau (for AI assistants)

Steps for an AI assistant setting up a Bureau hub for its user. The commands and outputs below were run on a fresh clone on macOS. CI starts the hub and runs the conformance suite on Linux and Windows; the Windows variants of these steps haven't been run by hand, so if one fails for you, say so in an issue. Follow them in order and check each expected output before moving on.

## 1. Prerequisites

```
node --version
git --version
curl --version
```

On Windows, run the steps in PowerShell or cmd, and type `curl.exe` instead of `curl` in Windows PowerShell 5.1 (there `curl` is an alias for `Invoke-WebRequest`). The `-d '{...}'` examples below use bash quoting; in PowerShell, send the same JSON with `Invoke-RestMethod -Method Post -Uri <url> -Headers @{ Authorization = "Bearer $env:TOKEN" } -ContentType application/json -Body '<json>'`.

- Node must be 18 or newer. The hub uses global `fetch` and `structuredClone`. Production runs Node 22; CI tests on 22 and on 18.
- git is required. The hub calls the `git` binary to keep the brain (its knowledge store) as a git repo, and exits at boot without it.
- There are no npm dependencies. Do not run `npm install`; there is no `package.json`.

## 2. Get the code

```
git clone https://github.com/mahoudeau/bureau
cd bureau/hub
```

All later commands run from `bureau/hub` unless they say otherwise.

## 3. Configure (usually nothing)

A new hub needs no configuration. Started with no token, it makes its own boss token, keeps it in `hub/data/boss-token` (mode 0600), runs in strict mode, and prints a one-time link that signs the user in as the owner. Don't create `.env` unless the user wants to change a setting below; if you do, start from `.env.example`, where everything is commented out.

On a server that other people reach, set `BUREAU_PUBLIC_URL` to its https address before the first start.

| Variable | Default | What it does |
|---|---|---|
| `BUREAU_BOSS_TOKEN` | the hub's own, in `data/boss-token` | The boss's credential. Only it, and people signed in as owner, can act as human, change settings and mint agent tokens. Set it only to choose your own; it must differ from `BUREAU_TOKEN`. |
| `BUREAU_TOKEN` | empty | The old shared token. With only this set, the hub runs in legacy mode and makes no token of its own; in strict mode it acts only as an agent. A placeholder from `.env.example` stops the boot. `BUREAU_ALLOW_INSECURE_LOCAL=1` is the opt-in for a tokenless demo on loopback. |
| `PORT` | 8100 | Listen port. |
| `IP` | `127.0.0.1` | Bind address, passed to the hub as `HOST`. An `IP` set by the host beats a `HOST` line in `.env`. |
| `HOST` | `127.0.0.1` | Bind address when the host sets no `IP`. `0.0.0.0` serves other machines, `::` for hosts that want IPv6. |
| `BUREAU_ALLOWED_ORIGINS` | unset | Comma-separated browser origins allowed to call the API. Same origin always works. |
| `BUREAU_DATA_DIR` | `hub/data` | Where `state.json` (missions, roster, messages, log) lives. |
| `BUREAU_BRAIN_DIR` | `hub/brain` | Where the brain's git repo lives. Created on first boot. |
| `BUREAU_WORK_DIR` | `hub/work` | The work store: open missions' evidence, plain files, deleted when a mission closes. |
| `BUREAU_BACKUP_INTERVAL_MS`, `BUREAU_BACKUP_KEEP`, `BUREAU_DAILY_KEEP` | 3600000, 24, 7 | Rolling `state.json` backups: how often, how many hourly, how many daily. |
| `BUREAU_PUBLIC_URL` | unset | A hub on a server: its https address, used in the MCP addresses and for sign-in. Leave it unset for a hub on the user's own computer. |
| `BUREAU_OIDC_ISSUER`, `BUREAU_OIDC_CLIENT_ID`, `BUREAU_OIDC_CLIENT_SECRET` | unset | Optional: sign-in through another OpenID issuer. With OMAKO there is nothing to set: see section 6. |
| `BUREAU_OIDC_OWNERS` | unset | Emails or subject ids of the hub's owners, for sign-in. |
| `BUREAU_POKES` | unset | Optional: outbound wake-up webhooks, a JSON array. See `docs/protocol.md`. |
| `BUREAU_SWEEP_MS` | 60000 | Lease-expiry and standing-work sweep interval. |
| `BUREAU_RESERVATION_TTL_MIN` | 30 | Minutes before a `cowork` agent's reservation lapses. Tests set 0.02. |

The hub loads `hub/.env` itself, from whatever folder it is started in, and only for variables the calling shell or host left unset: a variable already set in the environment wins. The listen address comes from `IP`, then `HOST`, then `127.0.0.1`.

## 4. Start

```
node server.js
```

`sh start.sh` does the same, for hosts whose start command has to be a shell line.

Expected output, ending with the first-run link:

```
Auth mode: strict
...
Bureau hub listening on [127.0.0.1]:8100

  Bureau is ready. Open this link to finish setting it up (it works once):

  http://localhost:8100/setup#key=...

  Lost it? On this machine, run: node tools/sign-in-link.js
```

Give that link to the user, and only to them: whoever opens it first is the owner. Don't open it yourself. If it gets lost or used, `node tools/sign-in-link.js` prints a new one, good for an hour. The link shows only on the first boot; a restart prints none.

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

Mint a token for a first agent. This talks to the running hub as the boss, with the hub's own token from `data/boss-token` (or `BUREAU_BOSS_TOKEN`, when set):

```
node tools/token.js mint first general
```

```
minted tok-1a2b3c4d for first, projects: general
token (shown once): 3f...
MCP URL: http://localhost:8100/mcp/3f...
```

Export it, and the boss token, so the commands below work as written: `export TOKEN=<the token above>`, `export BOSS_TOKEN=$(cat data/boss-token)`. Don't print the boss token where a third party can see it.

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

- The first-run link from step 4: the user opens it, is signed in as the owner, and lands in the setup guide. Nothing to paste.
- Sign in with OMAKO: the guide's next step, one click. OMAKO opens in a new tab, the user signs in or makes an account and confirms; whoever confirms becomes the hub's owner. From then on they sign in with OMAKO on any device, and agents sign in the same way. Let the user click it: it binds their hub to their account. On a server, `node tools/omako.js pair` does the same from the terminal. The hub keeps its client in `data/omako.json` and prints no secret. The rules are in `docs/protocol.md`, "Sign-in".
- Where the hub runs decides what reaches it. On the user's computer (no `BUREAU_PUBLIC_URL`), agents that run there connect: Claude Code (`claude mcp add --scope user --transport http bureau-consul <address>`, then `/mcp` to sign in), the terminal (`bureau login`, `connectors/cli/`). Apps that connect from the cloud, like claude.ai, ChatGPT and scheduled tasks, can't reach a laptop. The guide gives each agent's address and walks through it.
- Pixel office: http://localhost:8100/office . Same sign-in. It's empty until an agent registers.
- A hub without sign-in: from `bureau/hub`, `node tools/token.js mint <agent> <project,...>` prints the agent's token and its `MCP URL`. The URL itself is the credential; treat it like the token. Setup steps are in `connectors/chat/README.md`.
- Scheduled workers: `connectors/cowork/README.md`.
- Tell the user where their data is: `hub/data/` (the state, the boss token, the pairing) and `hub/brain/`, both gitignored.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `data dir is owned by a live hub process (pid N); refusing to boot` | Another hub uses the same `BUREAU_DATA_DIR`. | Stop that process, or point this one at another data dir. A lock left by a dead process is taken over automatically. |
| `Error: listen EADDRINUSE: address already in use :::8100` | Port taken. | Change `PORT` in `.env`, or set it in the shell (the shell wins over `.env`). |
| `{"error": "unauthorized"}` | Wrong or missing token. | Send `Authorization: Bearer <token>`, a minted token or `BUREAU_TOKEN`, or the boss token for boss actions. |
| "This link has been used or has expired" | A first-run or sign-in link works once. | `node tools/sign-in-link.js` prints a new one, good for an hour. |
| No link in the output | The hub was started before, or with a token of its own (`BUREAU_BOSS_TOKEN` or `BUREAU_TOKEN`). | `node tools/sign-in-link.js`. A hub on the old shared token alone has no boss token: set `BUREAU_BOSS_TOKEN` (see `UPGRADING.md`). |
| `{"error": "unknown project: x", "projects": [...]}` | Missions need an existing project. | Use one from the list, or create it as the boss: `POST /api/projects` with `{"label":"x"}`. The body also takes optional `id`, `entity` and `repo`. |

## 8. Run the tests (optional)

From the repo root, with a scratch hub on a fresh data and brain dir. The conformance suite runs on a legacy-mode hub with a known token, on purpose, so stop the hub from step 4 first or move it to another port:

```
BUREAU_TOKEN=devtoken PORT=8100 BUREAU_DATA_DIR=/tmp/bureau-test/data BUREAU_BRAIN_DIR=/tmp/bureau-test/brain BUREAU_WORK_DIR=/tmp/bureau-test/work BUREAU_RESERVATION_TTL_MIN=0.02 BUREAU_ENV_FILE=/dev/null node hub/server.js &
BUREAU_URL=http://127.0.0.1:8100 BUREAU_TOKEN=devtoken CONF_SHORT_TTL=1 CONF_BRAIN_DIR=/tmp/bureau-test/brain bash test/dummy-agent.sh
bash test/brain-lint.sh
sh test/pokes.sh
```

Each script ends with `passed N, failed 0` and exits with its failure count. `BUREAU_ENV_FILE=/dev/null` keeps the hub off any `.env` you made in step 3. `test/pokes.sh` starts its own hubs on ports 8196 to 8199 and kills whatever already listens there. On Windows, run the shell scripts in Git Bash, or the node tests with `node test/<name>.test.js`; `test/pokes.sh` needs `lsof` and is Linux and macOS only. `.github/workflows/ci.yml` is the reference.
