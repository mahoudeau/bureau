# Upgrading Bureau

For self-hosters. What changed in each release is in [CHANGELOG.md](CHANGELOG.md); this file is how to move between them safely.

## Where your data lives

- `hub/data/state.json`: missions, roster, messages, projects (or `BUREAU_DATA_DIR`).
- `hub/brain/`: the knowledge brain, a git repo (or `BUREAU_BRAIN_DIR`).

The brain has its own history in git. The state file is what the steps below protect.

## Upgrade

1. Check the running version: `curl https://your-hub/api/health -H "Authorization: Bearer $TOKEN"` shows `version` and `schema_version`.
2. Stop the hub. A clean stop (SIGTERM or SIGINT) writes any pending change and releases `data/hub.lock`.
3. Copy the state aside yourself, whatever the hub does for you: `cp hub/data/state.json hub/data/state.json.manual-<date>`.
4. Pull the new code: `git pull` (or check out the release tag, e.g. `git checkout v0.2.0`).
5. Read the release's entry in `CHANGELOG.md`, for new settings in particular.
6. Start the hub: `sh hub/start.sh`, or restart it the way your host does.
7. Check the log and `/api/health`. The version is the new one; `schema_version` is the one this release expects.

No `npm install`, ever. The hub has no dependencies.

## What happens on boot

The hub checks `state.json` before it listens.

- **It does not parse** (truncated write, bad hand edit, empty file): the hub refuses to start, prints why, and keeps a copy as `state.json.corrupt-<timestamp>`. It never starts on empty state in place of your data. It keeps refusing until you fix or restore the file (see Roll back).
- **It is missing but backups exist**: the hub refuses to start. Restore a backup, or move the backups away if you really mean to start fresh.
- **Another hub owns the data dir**: the second process refuses to start. A lock left by a dead process is taken over on its own.
- **Its `schema_version` is older than this release's**: the hub copies the file to `state.json.pre-migrate-<timestamp>`, runs the migrations in order, writes the result, and logs `migrating state from schema X to Y`. Missions, roster and messages carry over.
- **Its `schema_version` is newer than this release's** (you went back to older code): the hub refuses to start. Restore the matching `pre-migrate` file, or run the newer code.

### Migrations so far

| Schema | Release | What it does |
|---|---|---|
| 0 to 1 | Unreleased | Adds `schema_version` to the file and fills in top-level lists older files may lack (`agents`, `messages`, `log`). Nothing is removed or renamed. |

## Backups the hub keeps

In the data dir, next to `state.json`:

- `state.json.bak.1` to `state.json.bak.24`: one per hour, `.bak.1` the newest.
- `state.json.daily-YYYY-MM-DD`: the first of each UTC day, the last seven kept.
- `state.json.pre-migrate-<timestamp>`: one per migration, never deleted by the hub.
- `state.json.corrupt-<timestamp>`: a bad file set aside, never deleted by the hub.

Tune with `BUREAU_BACKUP_INTERVAL_MS` (default 3600000), `BUREAU_BACKUP_KEEP` (24) and `BUREAU_DAILY_KEEP` (7). These all sit on the same disk as the state: copy the data dir somewhere else now and then, the way you push the brain to a remote.

## Roll back

To the code and state from before an upgrade:

1. Stop the hub.
2. Check out the previous release: `git checkout v0.1.0` (or the commit you ran before).
3. Restore the state from before the migration: `cp hub/data/state.json.pre-migrate-<timestamp> hub/data/state.json`. Take the newest `pre-migrate` file whose time matches the upgrade.
4. Start the hub.

Anything written between the upgrade and the rollback is lost from the state (the brain keeps its own git history). If that matters, keep the migrated `state.json` aside before step 3.

To recover from a corrupt or bad state without changing code:

1. Stop the hub.
2. Pick the newest good backup: `state.json.bak.1`, then `.bak.2`, and so on, or a `daily-` file. `node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" <file>` exits quietly on a file that parses.
3. `cp` it over `state.json` and start the hub.
