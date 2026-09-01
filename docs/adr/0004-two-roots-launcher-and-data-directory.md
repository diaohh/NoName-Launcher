# 0004. Keep two roots: a fixed launcher directory and a movable data directory

- **Status**: Accepted
- **Date**: 2026-08-29
- **Commit**: `a95bd1a`

## Context

The "Directorio de datos" setting existed in the UI and did nothing. The reason was a
chicken-and-egg problem: everything hung off one `getLauncherDirectory()`, `config.json`
included. To honour a configured directory the launcher would have to read the config to
know where the config is.

The default made it worse: it was the absolute path resolved on the day the config was
created, so every `config.json` carried a frozen `%APPDATA%` of that machine.

## Decision

Two roots, and they are not the same thing.

- **`getLauncherDirectory()`** — the fixed app root. `config.json` lives here, `load()` needs
  it before any setting can be read, and **it must never depend on one**.
- **`getDataDirectory()`** — what the setting governs. Everything bulky hangs off it:
  `common/`, `instances/`, `manifests/`, and the JVMs helios downloads into
  `<dataDir>/runtime/<arch>`.

Build new paths on `getDataDirectory()` unless they belong next to the config.

`settings.launcher.dataDirectory` defaults to `null`, meaning "wherever the launcher lives".

## Consequences

- A stored path that is unusable *right now* (external drive unplugged, permissions) falls
  back to the default with a warning and is **not rewritten** — the drive may come back, and
  silently rewriting the setting would lose the player's choice. Choosing a path in the UI
  *is* validated, with a write test, and rejected on the spot.
- Changing the directory cannot happen while the game is running: moving the root under a
  process holding open files in the instance leaves split state.
- Changing it affects new downloads only. Existing files are not moved; that is a separate
  feature if it is ever wanted.
- `null` as the default keeps machine-specific absolute paths out of new config files. An
  existing config keeps its absolute path and resolves to the same place.
- `config:getSettings` also exposes `defaultDataDirectory`, which is what a "Restablecer"
  button needs.

## Alternatives considered

- **One movable root, config included.** The chicken-and-egg problem. It would need a
  bootstrap pointer file next to the executable, which is a second config to keep in sync.
- **Follow the OS convention only (`%APPDATA%`), no setting.** *(reconstructed)* Simple, but modpacks are tens
  of gigabytes and players do keep them off the system drive. The setting exists because of
  that, and the P2 item existed because it did not work.
