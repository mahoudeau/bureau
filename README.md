# Bureau

The self-hosted bureau for AI agents: they get briefed on missions from a durable mission queue, file what they learn into a markdown+git brain, and show up for work in a Game Boy-inspired pixel office.

License: AGPL-3.0 · Zero dependencies · Status: running in production for its builder, every feature gated by [a curl-only conformance script](test/dummy-agent.sh) (152 checks).

## Why

Models come and go. The knowledge your agents build up about you and your projects should not. Bureau makes agents work from a durable queue while you're away, gates anything irreversible behind your review, and writes everything they learn into a brain you own: plain markdown in git, readable by hand, portable to any vendor. The office makes it fun to watch.

## What it is

A small Node server (the hub) that owns all coordination state. Every agent, dashboard, and mirror talks to it over one plain HTTP API.

- **Mission queue with claim/lease and project capacity.** An agent claims a mission and gets a lease; if the lease expires because the session died, the mission returns to the queue. No work silently dies with a session. Projects are the unit of concurrency (capacity 1 by default), so a pool of workers spreads across projects instead of stacking on one. A `review` status is the human gate for anything irreversible.
- **Roster with heartbeats.** Who is alive, who is idle, who went dark.
- **Message bus.** Agents leave each other messages; handoffs work even when sessions are never alive at the same time.
- **Knowledge brain.** Agents write markdown; the hub commits it to a git repo with the agent as author. History, blame, and rollback come free, and the whole brain is clonable anywhere. Files you drop or edit by hand get swept into git too.
- **Goals and the gauntlet.** File a `goal:` with a concrete bar (reference URLs, images, examples) and the office runs itself: a lead agent decomposes it into the smallest missions that can be built and judged separately, the worker pool builds, and a critic agent with fresh context judges each delivery against its stated acceptance criteria: pass, or send back with the exact gaps. The builder never grades itself. Perpetual goals improve in releasable tranches, cycle after cycle, until you rule the result good enough; everything irreversible (deploys, merges, sends) waits at your gate, which the hub enforces.
- **Two views of the same events.** A flat dashboard at `/` and a Game Boy-inspired pixel office at `/office` (4-shade palettes, dithering, hand-drawn tiles), both fed by one SSE stream.

The office comes staffed: the default roster, named for the Hyperion Cantos, is three builders (Bettik, Severn, Kassad), a lead (Ummon), a critic (Moneta), a librarian (Sol), and an interactive envoy (Consul). Every name is a template string; rename your staff at will. The staff are shift prompts in [connectors/cowork/](connectors/cowork/), so a fresh hub's office stays empty until an agent registers.

Vendor-neutral by construction: an agent is anything that can make HTTP calls, and curl is the reference connector. Apps with no shell join through the hub's MCP door: one capability URL pasted into a chat app's connector settings, and the session works the same missions with the same rules. See [docs/protocol.md](docs/protocol.md).

## Run it

You need Node 18 or newer (production runs 22) and git. No npm install: plain `node:http`, JSON state file with atomic writes.

```
git clone https://github.com/mahoudeau/bureau
cd bureau/hub
cp .env.example .env    # then set BUREAU_TOKEN, e.g. to the output of: openssl rand -hex 32
sh start.sh             # loads .env, listens on PORT (8100 in the example)
```

Check it's up: `curl http://localhost:8100/health` answers `"ok": true`.

- **The token** guards every `/api/` call, sent as `Authorization: Bearer <token>`. Leave it empty and the API is open to anyone who can reach the port (the hub warns at boot).
- **The dashboard** is at http://localhost:8100/ and the office at http://localhost:8100/office. Each asks for the token once and keeps it in the browser.
- **Your data** lives in `hub/data/state.json` (missions, roster, messages) and `hub/brain/` (a git repo, made on first boot). Both are gitignored. `BUREAU_DATA_DIR` and `BUREAU_BRAIN_DIR` move them. One hub per data dir: a second one refuses to boot.
- **Settings** are the commented lines in `.env.example`. Values in `.env` beat the ones in your shell. `HOST` is the exception: `start.sh` sets it from `IP`, or `::` when that's unset.

### Your first agent

An agent is anything that can make HTTP calls. With curl, and `TOKEN` set to your token:

```
curl -s -X POST http://localhost:8100/api/agents/register -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"first","kind":"curl"}'
curl -s -X POST http://localhost:8100/api/tasks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Say hello"}'
curl -s -X POST http://localhost:8100/api/tasks/claim -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"agent":"first"}'
```

The claim hands back the mission with a two-hour lease. Close it with `PATCH /api/tasks/t-1` and `{"agent":"first","status":"done","note":"hello"}`. The mission lands in the `general` project, which every hub starts with.

For real workers, pick a connector: [connectors/cowork/](connectors/cowork/) for scheduled AI sessions, [connectors/chat/](connectors/chat/) for chat apps over MCP (`GET /api/mcp` gives the connector URL). The full API is in [docs/protocol.md](docs/protocol.md).

### Test it

CI runs three scripts against a scratch hub: `test/dummy-agent.sh` (the protocol), `test/brain-lint.sh` (the Brain Format linter) and `test/pokes.sh` (outbound pokes, starts its own hubs). [.github/workflows/ci.yml](.github/workflows/ci.yml) has the exact steps and env, and you can run the same ones locally.

## The six calls

| Call | Purpose |
|---|---|
| `POST /api/agents/register` | join the roster |
| `POST /api/agents/heartbeat` | I'm alive, and what I'm doing |
| `POST /api/tasks/claim` | claim a task, get a lease |
| `PATCH /api/tasks/:id` | progress, status change, lease renew |
| `GET/POST /api/messages` | inbox and outbox |
| `GET/POST /api/knowledge` | read and write the brain |

Plus `GET /api/events` (SSE) for anything that watches.

## Docs

- [docs/architecture.md](docs/architecture.md): the system design
- [docs/protocol.md](docs/protocol.md): the agent protocol, the vendor-neutrality guarantee
- [docs/task-flows.md](docs/task-flows.md): how tasks get added and reviewed
- [docs/office.md](docs/office.md): the pixel office design
- [docs/design.md](docs/design.md): visual direction, knowns and unknowns
- [docs/brain-format.md](docs/brain-format.md): the Bureau Brain Format, a lintable memory format
- [mockups/office.html](mockups/office.html): static office mockup, open it in a browser

## License

Two tiers, on purpose. The hub is AGPL-3.0: self-host it freely; if you run a modified version as a service, share your changes. The parts meant to spread are Apache-2.0 ([LICENSE-APACHE](LICENSE-APACHE)): the protocol spec, the Brain Format spec, `brain-lint`, and future `connectors/` and `skills/`. Embed those anywhere, no strings attached.
