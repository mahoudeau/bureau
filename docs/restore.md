# Restoring a Bureau hub

**Lose the private backup key and you lose the off-server backups.** The server only holds the public key, so it can write copies and never read them. The private key is on the Mac, in the Keychain, and it must also be in a password manager. Without it, nothing in Nextcloud can be read by anyone.

Two kinds of trouble, two ways back.

## A bad edit, a mission closed by mistake

Nothing to restore. A mission keeps its whole log, and the brain is a git repository: `git log` and `git revert` in the brain bring back any note. The brain is pushed to its remote, so it never needs these backups.

## The database is lost or broken

The copies, newest first.

1. **On the server**, in the data dir (SQLite store):
   - `bureau.db.bak.1` to `bureau.db.bak.24`: one per hour, `.bak.1` the newest.
   - `bureau.db.daily-YYYY-MM-DD`: one per day, the last seven.
   - `state.json.daily-YYYY-MM-DD`: the same days as plain JSON.
   - `bureau.db.pre-migrate-<time>`: taken before each schema migration.
2. **In Nextcloud**, under `Bureau-backup/<hub id>/` (or `BUREAU_NEXTCLOUD_DIR`):
   - `db/bureau-YYYY-MM-DD.db.gz.enc`: the whole database, one per night for 30 nights, and the copy of the 1st of each month for a year.
   - `current/`: last night's missions, agents, projects and settings as JSON (`missions.json.enc` and so on), and a `manifest.json.enc`.

   Every file there is encrypted. If the Nextcloud folder syncs to the Mac, the same files are on the Mac too.

The hub id is in `GET /api/backups` (operator), and `node hub/tools/hub-identity.js <data dir>` prints it on the server.

### Decrypt a copy on the Mac

The private key is in the Keychain (service `bureau-backup`, account the hub's host). If the Keychain lost it, bring it back from the password manager first:

```
pbpaste | bureau backup import-key --hub https://your.hub
```

Then, with the copy downloaded from Nextcloud:

```
bureau backup decrypt bureau-2026-11-14.db.gz.enc --hub https://your.hub
```

It writes `bureau-2026-11-14.db`, unpacked and ready to open, and never overwrites a file. A file that was changed, cut, or made for another key is refused. Check it before using it:

```
sqlite3 bureau-2026-11-14.db "PRAGMA integrity_check"
```

It must say `ok`. `bureau backup verify` does all of this with the newest copy in one go.

### Put it back

1. Stop the hub, so nothing writes while the file is swapped.
2. In the data dir, move `bureau.db`, `bureau.db-wal` and `bureau.db-shm` aside. Keep them, do not delete them.
3. Copy the decrypted file in as `bureau.db`, mode 0600.
4. Keep the hub's identity: the copy carries its hub id and public address, and a hub refuses a database that belongs to another. On the same server nothing changes. On a new server, set `BUREAU_HUB_ID` to the hub id and `BUREAU_PUBLIC_URL` to the same address, with `BUREAU_STORE=sqlite`.
5. Start the hub. `GET /api/health` answers, with `"store": "sqlite"`.
6. Look at the Desk and a few missions. Then run a backup at once: `POST /api/backups/run` with the boss token.

Anything written since the copy is gone. The brain is not in these copies: clone it from its remote into `BUREAU_BRAIN_DIR`.

To go back to the file store from a copy instead: `node hub/tools/state-export.js bureau-2026-11-14.db state.json` writes it as a `state.json` (see UPGRADING.md, "SQLite, optional").

## The hub itself is gone and no copy opens

`current/` in Nextcloud holds last night's missions, agents, projects and settings as JSON. Decrypt each with `bureau backup decrypt` to read them with any tool. They hold no token, no hash and no session: on a new hub, people sign in again and the boss mints agent tokens again. They are a record of what was there, not a database to boot on.

## The monthly check on the Mac

The hub records the last good check from the Mac, and shows the operator a red line on the Desk after 35 days without one. `bureau backup verify` fetches the newest copy, decrypts it with the Keychain key, opens it read-only, runs `integrity_check`, and reports the result to the hub. It needs, once:

```
pbpaste | bureau backup set-nextcloud --hub https://your.hub --url https://your.nextcloud --user you
pbpaste | bureau backup set-operator --hub https://your.hub
```

The first takes the Nextcloud app password from the clipboard, the second the boss token. Both go to the Keychain, never on screen. Opening the copy needs Node 22.13 or newer on the Mac.

To run it on the 1st of each month, a launchd job. Save this as `~/Library/LaunchAgents/dev.bureau.backup-verify.plist`, with your own paths for `node`, `bureau.js` and the hub:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.bureau.backup-verify</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/you/Code/bureau/connectors/cli/bureau.js</string>
    <string>backup</string>
    <string>verify</string>
    <string>--hub</string>
    <string>https://your.hub</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Day</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>10</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/bureau-backup-verify.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/bureau-backup-verify.log</string>
</dict>
</plist>
```

Then `launchctl load ~/Library/LaunchAgents/dev.bureau.backup-verify.plist`. A Mac asleep at 10:00 runs it when it wakes. The first run may ask once to let `security` read the Keychain items: allow it. The log holds one line per run, never a key or a password.
