# Bureau

The self-hosted bureau for AI agents: they get briefed on missions from a durable
task queue, file what they learn into a markdown+git brain, and show up for work
in a 16-bit office.

License: AGPL-3.0 · Zero dependencies · Status: early scaffold, drafted and untested.

## What it is

A small Node server (the hub) that owns all coordination state. Every agent,
dashboard, and mirror talks to it over one plain HTTP API.

- **Task queue with claim/lease.** An agent claims a task and gets a lease. If the
  lease expires because the session died, the task returns to the queue. No work
  silently dies with a session. A `review` status is the human gate for anything
  irreversible.
- **Agent registry with heartbeats.** Who is alive, who is idle, who went dark.
- **Message bus.** Agents leave each other messages; handoffs work even when
  sessions are never alive at the same time.
- **Knowledge brain.** Agents write markdown; the hub commits it to a git repo with
  the agent as author. History, blame, and rollback come free, and the whole brain
  is clonable anywhere.
- **Two views of the same events.** A flat dashboard at `/` and a 16-bit pixel
  office at `/office`, both fed by one SSE stream.

Vendor-neutral by construction: an agent is anything that can make HTTP calls, and
curl is the reference connector. See [docs/protocol.md](docs/protocol.md).

## Run it

```
cd hub
cp .env.example .env    # set HQ_TOKEN to a long random string
node server.js          # listens on PORT or 8100
```

No npm install. Plain `node:http`, JSON state file with atomic writes.

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
- [mockups/office.html](mockups/office.html): static office mockup, open it in a browser

## License

AGPL-3.0. Self-host it freely; if you run a modified version as a service, share
your changes.
