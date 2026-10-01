# Distribution

Where Bureau could be listed, what each place wants, and whether it fits. Draft, nothing submitted.

## The awkward part

Most MCP directories expect one of two things: a package that runs locally over stdio, or one public URL that anyone can call. Bureau is neither. Every install is its own hub, and its MCP door lives at `https://<your-host>/mcp/<capability-token>`. The token is the auth. There is no shared endpoint to list, and the URL must never be public.

So the honest listing is "self-host it, then paste your own URL". Places that can say that fit. Places that want to call the server themselves don't, unless we run a public demo hub with throwaway data.

## The places

| Place | How you get in | What it needs | Fits? |
|---|---|---|---|
| Official MCP registry (registry.modelcontextprotocol.io) | `mcp-publisher` CLI, GitHub login proves the `io.github.mahoudeau/` namespace | `server.json` at the repo root (drafted, see below) | Yes, with a templated remote URL. See the open points. |
| PulseMCP, and other directories that read the official registry | Nothing extra, they ingest the registry | The registry entry | Yes, follows the registry |
| Glama (glama.ai/mcp/servers) | Indexes public GitHub repos, or the "Add server" form | A server it can build and start in its own container to run checks. Reported to expect stdio. | Weak. Bureau has no stdio mode, so the checks likely fail and the score stays low. |
| awesome-mcp-servers (punkpeye) | Pull request adding one line | A Glama listing and its score badge on the line | Only as far as Glama fits |
| mcp.so | Pull request or its submit form | One line: name, link, description | Yes, it's just a link |
| Smithery (smithery.ai) | Paste a public HTTPS URL, or `smithery mcp publish` | A Streamable HTTP endpoint where initialize and tools/list work without auth. It proxies the traffic. | No, not without a public demo hub. Listing a real hub would publish its capability URL. |
| Docker MCP catalog (docker/mcp-registry) | Pull request | An image and a catalog entry. Remote support unverified. | Unclear, check before spending time |
| Other awesome lists (wong2/awesome-mcp-servers, awesome-selfhosted) | Pull request | A line and their own criteria. awesome-selfhosted wants a working, maintained project with a Docker or install path. | awesome-selfhosted fits the "self-hosted" story better than any MCP list |

## server.json

`server.json` at the repo root is the draft for the official registry. Schema `2025-12-11`, checked against the published schema file. It lists one remote:

```
https://{hub_host}/mcp/{capability_token}
```

with `hub_host` required and `capability_token` required and secret. No package entry, since nothing is published to npm or a container registry.

## Open points to verify before publishing

- **Templated host.** The schema allows `{hub_host}` (the URL pattern is just `https?://` plus no spaces), and the docs show path variables for multi-tenant servers. They also say a remote "MUST be publicly accessible". A URL that only exists once you self-host stretches that. Unknown whether review or the publisher CLI refuses it.
- **Version.** `0.1.0` matches the hub's `serverInfo`. Bureau has no release tags yet. Each registry publish needs a new version.
- **websiteUrl and icons.** Left out. Add them once there's a public site to point at.
- **An OCI package instead, or as well.** The registry takes container images from Docker Hub or ghcr.io, as long as the image carries `LABEL io.modelcontextprotocol.server.name="io.github.mahoudeau/bureau"`. That would mean publishing the image. The label is not in the Dockerfile yet.
- **Glama checks.** Whether Glama can be told the server is remote-only, or will just mark it as failing.
- **A demo hub.** Smithery and Glama scoring both want something they can call. A public hub with fake data, reset nightly, would unlock both. It's also a thing to run and watch.

## Suggested order

1. Official registry, once the open points above are settled. It feeds the downstream directories for free.
2. mcp.so and awesome-selfhosted, plain lines.
3. Glama and the awesome-mcp-servers line only if a demo hub exists.
