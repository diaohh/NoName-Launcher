# 0007. Encrypt account secrets with `safeStorage`, and never fall back to plaintext

- **Status**: Accepted
- **Date**: 2026-08-28
- **Commit**: `3408b1e`, `a4f930a`, `a0c1f4f`, `e65e9f6`

## Context

`config.json` stored the Minecraft access token and both Microsoft tokens in the clear, and
`config:load` handed the entire config — tokens included — to the renderer over IPC.

Encrypting the file wholesale was not an option: `config.json` is inspected by hand when
something goes wrong, and `load()` used to overwrite an unreadable file with the defaults,
so a single parse error silently wiped every setting the player had.

## Decision

- The three secrets — `accessToken`, `microsoft.access_token`, `microsoft.refresh_token` —
  are folded into **one `secrets` blob encrypted with Electron's `safeStorage`**. The rest of
  the account (username, uuid, expiries) stays readable, so the file remains inspectable.
- The file carries a `CONFIG_VERSION` stamp; v0 files are migrated and encrypted on the first
  `load()`.
- **If `safeStorage.isEncryptionAvailable()` is false** (Linux with no keyring), credentials
  are **not persisted at all**. The session lives in memory and the player logs in again next
  start. There is no plaintext fallback.
- A decryption failure costs the session and nothing else: `purgeSession` clears
  `authenticationDatabase` and `selectedAccount` and leaves every setting, the data directory
  and the selected modpack alone.
- `load()` never overwrites a file it failed to read — an unparseable one is moved to
  `config.json.corrupt-<timestamp>`.
- The Minecraft `accessToken` **never reaches the renderer**. The renderer gets `username`,
  `uuid`, `displayName`; `LaunchManager` reads the token from `ConfigManager` inside main.
- A **transient** failure (no network, 5xx, 429) must never delete an account.
  `AuthManager.classifyRestError` separates transport failures from `AUTH_INVALID_GRANT`;
  only a code in `TERMINAL_CODES` justifies a logout, and an unrecognised error deliberately
  does **not**.

## Consequences

- `safeStorage` requires `app.whenReady()`. That holds because `ConfigManager.load()` runs
  inside `createWindow()`; moving `load()` earlier breaks encryption silently.
- Secrets are bound to the OS user and machine. Copying `config.json` to another machine
  loses the session, which is the intended property.
- Losing the keyring costs a login, never the settings — the split between `purgeSession` and
  a full reset is the invariant that guarantees it.
- `microsoft.expires_at` is the expiry of the Microsoft **access** token (~1 h), not of the
  refresh token (~90 days). Treating it as "the session is over" logged every player out a
  day after login; do not reintroduce that comparison.
- The renderer cannot be the layer that decides a session is dead, because it never holds the
  token. It branches on codes from [0002](0002-ipc-error-envelope.md) instead.

## Alternatives considered

- **Encrypt the whole config file.** Loses hand-inspection, and a keyring failure would then
  take the settings down with the session.
- **Ship an app-level key.** *(reconstructed)* A key inside the bundle is not a secret; it only changes who has
  to bother.
- **Store nothing and log in every launch.** The safest option, and the one the no-keyring
  path actually degrades to — but as the default it makes the launcher unpleasant for the
  common case where `safeStorage` works.

## Addendum (2026-09-17)

- The list of terminal codes lives in `src/shared/errorCodes.js` as `TERMINAL_AUTH_CODES`
  (checked with `isTerminalAuthCode`), not `TERMINAL_CODES` as written above.
- The Minecraft `accessToken` does leave the main process in one place: it is passed to the
  game as `--accessToken` on the JVM command line, which other local processes of the same user
  can read. That is inherent to Mojang's argument format and cannot be avoided by a launcher;
  the guarantee of this ADR is about the renderer and the disk, not the game process.
