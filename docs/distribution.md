# Distribution

Where Bureau could be listed, what each place wants, and whether it fits. Draft, nothing submitted.

## The awkward part

Most MCP directories expect one of two things: a package that runs locally over stdio, or one public URL that anyone can call. Bureau is neither. Every install is its own hub, and its MCP door lives at `https://<your-host>/mcp/<capability-token>`. The token is the auth. There is no shared endpoint to list, and the URL must never be public.

So the honest listing is "self-host it, then paste your own URL". Places that can say that fit. Places that want to call the server themselves don't, unless we run a public demo hub with throwaway data.

## The places

| Place | How you get in | What it needs | Fits? |
|---|---|---|---|
| Official MCP registry (registry.modelcontextprotocol.io) | `mcp-publisher` CLI, GitHub login proves the `io.github.mahoudeau/` namespace | `server.json` at the repo root (drafted, see below) | Yes, with a templated remote URL |
| PulseMCP, and other directories that read the official registry | Nothing extra, they ingest the registry | The registry entry | Yes, follows the registry |
| Glama (glama.ai/mcp/servers) | Indexes public GitHub repos, or the "Add server" form | A server it can build and start in its own container to run checks. Reported to expect stdio. | Weak. Bureau has no stdio mode, so the checks likely fail and the score stays low. |
| awesome-mcp-servers (punkpeye) | Pull request adding one line | A Glama listing and its score badge on the line | Only as far as Glama fits |
| mcp.so | Pull request or its submit form | One line: name, link, description | Yes, it's just a link |
| Smithery (smithery.ai) | Paste a public HTTPS URL, or `smithery mcp publish` | A Streamable HTTP endpoint where initialize and tools/list work without auth. It proxies the traffic. | No, not without a public demo hub. Listing a real hub would publish its capability URL. |
| Docker MCP catalog (docker/mcp-registry) | Pull request | An image and a catalog entry. Remote support unverified. | Unclear, check before spending time |
| Other awesome lists (wong2/awesome-mcp-servers, awesome-selfhosted) | Pull request | A line and their own criteria. awesome-selfhosted wants a working, maintained project with a Docker or install path. | awesome-selfhosted fits the "self-hosted" story better than any MCP list |

## The image

From v0.2.0 on, every `v*` tag builds the hub image for amd64 and arm64 and pushes it to `ghcr.io/mahoudeau/bureau` as `0.2.0`, `0.2` and `latest` (`.github/workflows/release-image.yml`). Older tags have no image. The image carries `io.modelcontextprotocol.server.name=io.github.mahoudeau/bureau`, which is how the registry checks that an image belongs to a server entry.

## server.json

`server.json` at the repo root is the draft for the official registry. It lists one remote and no package:

```
https://{hub_host}/mcp/{capability_token}
```

`hub_host` is required, `capability_token` is required and secret. A client that reads the registry asks the user for both and builds the URL. `websiteUrl` points at the Docker section of the README, which is where the image is.

It passes the registry's own validators (`ValidateServerJSON`, schema plus semantic checks), run locally from the registry's source. Nothing was sent to the registry.

### What the registry accepts

- **Templated hosts are fine.** The remote-servers doc shows `https://{tenant_id}.analytics.example.com/mcp` as its own example, and the validator's tests include `https://{region}.example.com/mcp/{tenant_id}` as valid. Each `{name}` must be declared under `variables`. Variables take `isSecret`, `isRequired`, `default`, `choices` and `placeholder`.
- **What a remote can't be.** It must be `https`, and the host can't be `localhost`, `127.0.0.1` or `*.localhost`. The template gets filled with placeholders before that check, so `{hub_host}` passes.
- **Two servers can't share a remote URL.** The registry checks this on the literal string, template and all. Ours is unique.
- **"Publicly accessible".** The docs say a remote "MUST be publicly accessible at its specified URL". Nothing enforces it at publish time, and the moderation policy only removes "non-functioning servers". A per-user host is the documented multi-tenant pattern, so it reads as allowed. Outside census scripts that probe registry endpoints will just skip us or count us broken.
- **OCI packages.** The image must sit on Docker Hub, ghcr.io, Quay or a few cloud registries. Its label must match `name`. The tag goes inside `identifier` (`ghcr.io/mahoudeau/bureau:0.2.0`), and a separate `version` field is refused. `transport` is required.

### Why no package entry yet

A package with `streamable-http` transport needs a URL, and every `{name}` in that URL must be one of the package's environment variables or arguments. The hub makes up its capability token on first boot and keeps it in `state.json`, so there's no variable to point at. The validator fails that shape: `template variables in URL http://localhost:8100/mcp/{capability_token} reference undefined variables`.

Two ways out:

1. **Let the hub take its capability token from the environment.** Add a `BUREAU_MCP_TOKEN` setting, and use it when it's set instead of the generated one. The package entry then validates:

   ```json
   {
     "registryType": "oci",
     "identifier": "ghcr.io/mahoudeau/bureau:0.2.0",
     "runtimeHint": "docker",
     "transport": { "type": "streamable-http", "url": "http://localhost:8100/mcp/{BUREAU_MCP_TOKEN}" },
     "environmentVariables": [
       { "name": "BUREAU_TOKEN", "isRequired": true, "isSecret": true },
       { "name": "BUREAU_MCP_TOKEN", "isRequired": true, "isSecret": true }
     ]
   }
   ```

   The catch: a client that installs from this entry would start the hub itself, and stop it when the chat ends. Bureau is a long-running server that other agents rely on. A hub that lives and dies with one chat window is the wrong shape for it.
2. **Leave the package out, as now.** The remote entry tells clients how to connect. The README tells people how to run the hub. The image is still published and labelled, so a package entry can be added later without rebuilding anything.

Recommendation: option 2, remote only.

## Open points

- **Version.** `server.json` says `0.2.0`, the first release with an image. The hub's MCP `serverInfo` still says `0.1.0`. Bump them together when tagging. Each registry publish needs a new version.
- **Icons.** None yet.
- **Glama checks.** Whether Glama can be told the server is remote-only, or will just mark it as failing.
- **A demo hub.** Smithery and Glama scoring both want something they can call. A public hub with fake data, reset nightly, would unlock both. It's also a thing to run and watch.

## Sources

- Remote servers: https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/remote-servers.mdx
- Package types (OCI): https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx
- Official registry requirements: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md
- Moderation policy: https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/moderation-policy.mdx
- Validators: https://github.com/modelcontextprotocol/registry/blob/main/internal/validators/validators.go and `utils.go` (`IsValidRemoteURL`), tests in `validators_test.go`
- OCI ownership check: https://github.com/modelcontextprotocol/registry/blob/main/internal/validators/registries/oci.go
- Duplicate remote URLs: https://github.com/modelcontextprotocol/registry/blob/main/internal/service/registry_service.go
- Schema: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json

## Suggested order

1. Official registry, after tagging v0.2.0. It feeds the downstream directories for free.
2. mcp.so and awesome-selfhosted, plain lines.
3. Glama and the awesome-mcp-servers line only if a demo hub exists.
