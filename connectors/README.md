# Connectors

A connector is any glue that (a) reports a runtime's activity into the protocol and/or (b) wakes agents up in that runtime. Connectors know the hub; the hub never knows connectors (see `../docs/protocol.md`). The reference connector is curl, and everything here is optional.

Everything in `connectors/` is licensed Apache-2.0 (`../LICENSE-APACHE`): this code is meant to live inside your own tooling, unlike the AGPL hub.

| Connector | What it does |
|---|---|
| [`cowork/`](cowork/) | scheduled cloud sessions work the queue in shifts: the autonomy engine |
| [`claude-code/`](claude-code/) | local coding sessions work as the boss's envoy: `hub.sh`, project resolution and a context hook today; a plugin, more hooks and skills planned |
| [`chat/`](chat/) | conversations in any MCP chat app: the agent's address, a sign-in and a preferences paragraph, no code |
| [`cli/`](cli/) | `bureau login`: signs a terminal in as one agent; `claude-code/` reads it |

## Sign-in and tokens

On a hub with sign-in, each agent connects through an app: a chat app's connector at `https://<hub>/mcp/agent/<name>`, a scheduled task's own connector, or `bureau login` in a terminal. The owner turns the agent's sign-in on in Settings and allows each app once on the Desk. Nothing long-lived is pasted anywhere (`../docs/protocol.md`, "Sign-in").

On a hub without sign-in, in strict mode, each agent connects with its own token, minted with `node hub/tools/token.js mint <agent> <project,...>` and bound to that name and project list: the hub refuses any other `agent`, `author` or `from`. Set `BUREAU_AGENT` for `context-hook.js` when the agent is not `consul`. During an upgrade the old shared `BUREAU_TOKEN` keeps working, as an agent only (`../UPGRADING.md`).
