# Installing Bureau (for AI assistants)

Steps for an AI assistant setting up a Bureau hub for its user. Every command and output below was run on a fresh clone. Follow them in order and check each expected output before moving on.

## 1. Prerequisites

```
node --version
git --version
curl --version
```

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

```
cp .env.example .env
openssl rand -hex 32
```

Edit `.env` and set `BUREAU_TOKEN` to the random string. Keep `PORT=8100` unless the user wants another port.

| Variable | Default | What it does |
|---|---|---|
| `BUREAU_TOKEN` | empty | Bearer token for every `/api/` call. Empty means the API is open to anyone who can reach the port; the hub prints a warning at boot. Always set it. |
| `PORT` | 8100 | Listen port. |
| `IP` | `::` | Bind address, read by `start.sh` and passed to the hub as `HOST`. A `HOST` line in `.env` has no effect under `start.sh`. |
| `BUREAU_DATA_DIR` | `hub/data` | Where `state.json` (missions, roster, messages, log) lives. |
| `BUREAU_BRAIN_DIR` | `hub/brain` | Where the brain's git repo lives. Created on first boot. |
| `BUREAU_PUBLIC_URL` | unset | Public base URL. Used in review links and in the MCP connector URL. |
| `DISCORD_WEBHOOK_URL` | unset | Optional: mirror notable events to a Discord channel. |
| `BUREAU_POKES` | unset | Optional: outbound wake-up webhooks, a JSON array. See `docs/protocol.md`. |
| `BUREAU_SWEEP_MS` | 60000 | Lease-expiry and standing-work sweep interval. |
| `BUREAU_RESERVATION_TTL_MIN` | 30 | Minutes before a `cowork` agent's reservation lapses. Tests set 0.02. |

`start.sh` loads `.env` only for variables the calling shell or host left unset: a variable already set in the environment wins. The listen address comes from `IP`, then `HOST`, then `::`.

## 4. Start

```
sh start.sh
```

Expected output, on one line:

```
Bureau hub listening on [::]:8100
```

It runs in the foreground. Stop it with Ctrl-C or `kill <pid>`. To run it in the background for the rest of the session, start it with `sh start.sh > hub.log 2>&1 &`.

On first boot git may print a `hint:` block about the default branch name, and every `/api/state` call logs `fatal: your current branch 'master' does not have any commits yet` until the brain's first commit. Both are harmless.

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

Register a first agent (replace `$TOKEN` with the token, or `export TOKEN=...` first):

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

Create, claim and close a mission:

```
curl -s -X POST http://localhost:8100/api/tasks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Say hello"}'
curl -s -X POST http://localhost:8100/api/tasks/claim -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"agent":"first"}'
curl -s -X PATCH http://localhost:8100/api/tasks/t-1 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"agent":"first","status":"done","note":"hello"}'
```

Expect `"status": "queued"`, then `"status": "claimed"` with a `lease_until` two hours out, then `"status": "done"`. Missions without a `project` go to `general`, which exists on every new hub. An unknown project id is refused with the list of existing ones.

Write to the brain:

```
curl -s -X POST http://localhost:8100/api/knowledge -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"file":"notes/hello.md","content":"# Hello","author":"first"}'
```

```
{
 "file": "notes/hello.md",
 "bytes": 7
}
```

`git -C brain log --format="%an %s"` (from `bureau/hub`) then prints `first update notes/hello.md`.

## 6. Hand over to the user

- Dashboard: http://localhost:8100/ . It prompts for the token once and stores it in the browser.
- Pixel office: http://localhost:8100/office . Same token, same storage. It's empty until an agent registers.
- MCP connector URL for chat apps: `curl -s http://localhost:8100/api/mcp -H "Authorization: Bearer $TOKEN"` returns `{"url": "http://localhost:8100/mcp/<48 hex chars>"}`. The URL itself is the credential; treat it like the token. It uses `BUREAU_PUBLIC_URL` as its base when that's set. Setup steps are in `connectors/chat/README.md`.
- Scheduled workers: `connectors/cowork/README.md`.
- Tell the user where their data is: `hub/data/state.json` and `hub/brain/`, both gitignored.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `data dir is owned by a live hub process (pid N); refusing to boot` | Another hub uses the same `BUREAU_DATA_DIR`. | Stop that process, or point this one at another data dir. A lock left by a dead process is taken over automatically. |
| `Error: listen EADDRINUSE: address already in use :::8100` | Port taken. | Change `PORT` in `.env`, or set it in the shell (the shell wins over `.env`). |
| `{"error": "unauthorized"}` | Wrong or missing token. | Send `Authorization: Bearer <BUREAU_TOKEN>`. |
| `{"error": "unknown project: x", "projects": [...]}` | Missions need an existing project. | Use one from the list, or create it: `POST /api/projects` with `{"label":"x"}`. |

## 8. Run the tests (optional)

From the repo root, with a scratch hub on a fresh data and brain dir:

```
BUREAU_TOKEN=devtoken PORT=8100 BUREAU_DATA_DIR=/tmp/bureau-test/data BUREAU_BRAIN_DIR=/tmp/bureau-test/brain BUREAU_RESERVATION_TTL_MIN=0.02 node hub/server.js &
BUREAU_URL=http://127.0.0.1:8100 BUREAU_TOKEN=devtoken CONF_BRAIN_DIR=/tmp/bureau-test/brain bash test/dummy-agent.sh
bash test/brain-lint.sh
sh test/pokes.sh
```

Each script ends with `passed N, failed 0` and exits with its failure count. `test/pokes.sh` starts its own hubs on ports 8196 to 8199 and kills whatever already listens there. On macOS, the stock `/bin/bash` 3.2 fails one `dummy-agent.sh` check ("it is now an independent roster agent") because of a quoting bug in that old bash; bash 5 passes. `.github/workflows/ci.yml` is the reference.
