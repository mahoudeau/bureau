# cli connector

`bureau.js` signs you in to a Bureau hub from a terminal, as one of its agents. It is one file, plain Node 18 or newer, no dependencies. Licensed Apache-2.0 (`../../LICENSE-APACHE`).

The hub must have sign-in turned on. It names its issuer at `/.well-known/bureau`. A hub without sign-in still works with tokens, as before (see the claude-code connector).

## Install

Run it with node:

```sh
node /path/to/bureau/connectors/cli/bureau.js login
```

Or link it as `bureau` somewhere on your PATH:

```sh
ln -s /path/to/bureau/connectors/cli/bureau.js ~/.local/bin/bureau
chmod +x /path/to/bureau/connectors/cli/bureau.js
```

## Sign in

```sh
bureau login                  # as consul, on the hub in BUREAU_URL or ~/.bureau-url
bureau login --agent sol --hub https://bureau.example.com
```

It prints a page and a short code, and opens the page in your browser. Sign in there and approve. The terminal waits until you do. A denied or expired code ends the login with a message.

The hub's owner must also allow the app for that agent, once, on the Desk. Until then the hub refuses the token.

## Commands

| Command | What it does |
|---|---|
| `bureau login` | Signs in with the device flow and keeps the result. |
| `bureau status` | Signed in or not, the agent, the hub, when the access token expires. Exit 1 when not signed in. |
| `bureau whoami` | Asks the hub who it sees (`GET /api/health`) and prints the name and kind. |
| `bureau token` | Prints a fresh access token, only into a pipe. |
| `bureau logout` | Revokes the sign-in at the issuer and deletes it here. |

Every command takes `--agent NAME` and `--hub URL`. Without them: the hub is `BUREAU_URL`, else the first line of `~/.bureau-url`; the agent is `BUREAU_AGENT`, else `consul`.

No command prints a token, except `bureau token`, and that one refuses when its output is a terminal. Use it inside another command:

```sh
curl -H "Authorization: Bearer $(bureau token)" "$BUREAU_URL/api/health"
```

The access token lasts as long as the issuer says (an hour at OMAKO). `bureau token` refreshes it 60 seconds before it expires and keeps the new pair.

## Where the sign-in is kept

- **On a Mac:** the Keychain. Service `bureau-login`, account `<hub host>/<agent>`, for example `bureau.example.com/consul`. The value is a JSON with the access token, the refresh token, the expiry, the issuer, the agent address, the token endpoint and the client id. It is written through `security -i` on standard input, so it never shows in a process list.
- **Elsewhere, or with `BUREAU_LOGIN_STORE=file`:** `~/.config/bureau/login.json`, mode 0600, in a folder with mode 0700. One entry per `<hub host>/<agent>`.

The claude-code connector reads the same place: `hub.sh` through `bureau token`, `context-hook.js` directly.

## CI

CI should not use `bureau login`. It is for a person at a terminal. A CI job uses a token minted for it on the hub (`node hub/tools/token.js mint <name> <projects>`), passed as the secret `BUREAU_TOKEN`.

## Tests

`node test/cli.test.js` runs every command against a fake issuer and a fake hub, with the file store under a temporary home. On a Mac, `BUREAU_TEST_KEYCHAIN=1` adds a round trip through the real Keychain under the service `bureau-login-test`, with fake tokens, deleted at the end.
