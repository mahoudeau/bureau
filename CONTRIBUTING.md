# Contributing to Bureau

Thanks for looking. Bureau is small on purpose, and these rules keep it that way.

## Run the hub

You need Node and git. Nothing else: there is no `npm install`.

```
cd hub
cp .env.example .env    # Windows: copy. Then set BUREAU_TOKEN to a long random string
node server.js          # reads .env, listens on PORT or 8100
```

State goes to `hub/data/` and the brain (a git repo the hub commits to) to `hub/brain/`. `BUREAU_DATA_DIR` and `BUREAU_BRAIN_DIR` move them. The dashboard is at `/`, the office at `/office`.

## Run the tests

Three scripts in `test/`, all plain shell and curl, plus node tests (`node test/<name>.test.js`, no dependencies either). Run them from the repo root. On Windows, the node tests run as they are and the shell scripts run in Git Bash; `test/brain-lint.test.js` is the node twin of `test/brain-lint.sh`. `test/storage.sh` and `test/pokes.sh` need `lsof` and stay Linux and macOS only.

**Conformance** (`test/dummy-agent.sh`) drives the whole protocol against a running hub. It creates missions, projects and brain files, so point it at a scratch hub, never at one you care about. The short reservation TTL and `CONF_BRAIN_DIR` let every section run instead of skipping or waiting 30 minutes:

```
# terminal 1: a throwaway hub
BUREAU_TOKEN=devtoken PORT=8150 BUREAU_RESERVATION_TTL_MIN=0.02 \
BUREAU_DATA_DIR=/tmp/bureau-test/data BUREAU_BRAIN_DIR=/tmp/bureau-test/brain \
node hub/server.js

# terminal 2
BUREAU_URL=http://localhost:8150 BUREAU_TOKEN=devtoken \
CONF_BRAIN_DIR=/tmp/bureau-test/brain ./test/dummy-agent.sh
```

Delete `/tmp/bureau-test` between runs. It ends with `CONFORMANT` or `NOT CONFORMANT` and exits with the number of failed checks.

**Pokes** (`test/pokes.sh`) starts its own hub and webhook sink on ports 8196 to 8199 and cleans up after itself:

```
./test/pokes.sh
```

**Brain lint** (`test/brain-lint.sh`) checks `hub/tools/brain-lint.js` against the valid and invalid fixtures:

```
./test/brain-lint.sh
```

A new hub feature comes with checks in `test/dummy-agent.sh`. If curl can't reach it, it's designed wrong (see `docs/protocol.md`).

## Hard rules

- **Zero dependencies in the hub.** Node's standard library only: no `package.json`, no `node_modules`, no vendored libraries. A PR that adds one won't be merged, however small it is.
- **Vendor-neutral core.** No vendor name (Claude, OpenAI, ...) in hub code, hub events or office rendering; vendor names live only in `connectors/` ([docs/protocol.md](docs/protocol.md)).

## Branches

- Work tied to a Bureau mission: `t-<id>-<slug>`, for example `t-356-sol-deadlock`.
- Anything else: a short descriptive name, for example `fix-sse-reconnect`.

## Pull requests

- All three test scripts and the node tests pass before you ask for review. If you're on Windows and can't run `storage.sh` or `pokes.sh`, say so in the PR and CI runs them.
- Keep PRs small. One change per PR; split a refactor from the feature that needs it.
- Say what changed and why. The why matters more: the diff already shows the what.
- Touching the protocol means updating `docs/protocol.md` in the same PR.

## The CLA

Contributions to the AGPL-3.0 parts (`hub/` and everything else not listed below) need a signed [Contributor License Agreement](CLA.md). The Apache-2.0 parts need none: `docs/protocol.md`, `docs/brain-format.md`, `hub/tools/brain-lint.js`, `connectors/` and `skills/`. The CLA assistant bot comments on your first PR with a link; sign in with GitHub, give your name and email, and accept once. It asks on every PR, so ignore it if yours only touches the Apache-2.0 parts. [CLA.md](CLA.md) explains what it covers and why it exists.

## Licenses

The hub is AGPL-3.0 ([LICENSE](LICENSE)). The protocol spec (`docs/protocol.md`), the Brain Format spec (`docs/brain-format.md`), brain-lint (`hub/tools/brain-lint.js`), `connectors/` and `skills/` are Apache-2.0 ([LICENSE-APACHE](LICENSE-APACHE)). Your contribution ships under the license of the part it touches.

## Conduct and security

We follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
