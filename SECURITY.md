# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**. If you can't use GitHub, write to **security@getbureau.dev**. Include what you found, how to reproduce it, and the commit you tested.

You'll get an acknowledgement within a week. Bureau is maintained by one person, so a fix can take longer; you'll hear where it stands either way. Once a fix is out, you're credited in the release notes unless you'd rather not be.

## What's in scope

The hub (`hub/`), in particular:

- **Token handling.** The single Bearer token (`BUREAU_TOKEN`), including where it travels as a query parameter (the SSE stream), and anything that lets a request through without it.
- **The MCP capability URL** (`/mcp/<token>`). The URL is the credential: a way to guess it, derive it, or find it in a log, event, page or poke payload is in scope.
- **Capability links.** The review, answer and view links the hub issues, and the image route behind them.
- **Brain write paths.** `POST /api/knowledge` and the hand-drop sweep: escaping the brain directory, writing into `.git`, getting past the file-type allowlist, or getting git to run something it shouldn't.
- **Rendering.** Script injection through mission titles, notes, brain content or SVG attachments into the dashboard, the office or the review pages.
- **Review gates.** Moving a boss-gate mission in or out of `review` without the role the protocol requires.

## What's out of scope

- Anyone who holds the Bearer token. It's a single shared secret and grants full access by design; a token holder doing what the token allows is not a vulnerability.
- Your own deployment: TLS, the host, the reverse proxy, where you keep `.env`.
- Connectors and chat-app settings outside this repository.
- Denial of service by volume.

## Supported versions

Only the latest commit on `main`. There are no release branches yet.
