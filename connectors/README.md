# Connectors

A connector is any glue that (a) reports a runtime's activity into the protocol and/or (b) wakes agents up in that runtime. Connectors know the hub; the hub never knows connectors (see `../docs/protocol.md`). The reference connector is curl, and everything here is optional.

Everything in `connectors/` is licensed Apache-2.0 (`../LICENSE-APACHE`): this code is meant to live inside your own tooling, unlike the AGPL hub.

| Connector | What it does |
|---|---|
| [`cowork/`](cowork/) | scheduled cloud sessions work the queue in shifts: the autonomy engine |
| [`claude-code/`](claude-code/) | local coding sessions work as the boss's envoy: project resolution today, hooks and skills later |
| [`chat/`](chat/) | conversations in any MCP chat app: a capability URL plus a preferences paragraph, no code |
