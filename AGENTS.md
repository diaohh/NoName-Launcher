# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot, Cursor…) working in this repository. This is
the versioned copy; a local `CLAUDE.md` (gitignored) only imports it, so edit this file, not that one.

## Project

NoNameLauncher — A Minecraft launcher built with Electron 45, React 19, and Tailwind CSS v4. Uses Microsoft authentication, Firestore for modpack distribution, and helios-core for game management.

## Architecture Decisions

The **why** behind the rules in this file lives in [`docs/adr/`](docs/adr/README.md), one file
per decision, superseded rather than rewritten. Read the relevant ADR before arguing with a rule
here, and write a new one when a decision is structural, contested, or deliberately deferred —
the index says what qualifies. `TODO.md` is pending work only; it is not where decisions are
recorded. A factual correction that leaves a decision standing goes in a dated `## Addendum` at
the end of the ADR, never as an in-place edit.

Full reviews are done by hand and kept in `docs/audits/`, which is **gitignored**: the reports are
local working material and are never committed (latest: `2026-09-17-auditoria.md`). Their actionable
findings are in `TODO.md`, marked 📋 and tagged `S`/`B`/`D` + number, which points back to the
report's tables. If you have the report, read it before touching an area it flags.

## Commands

```bash
pnpm dev          # Start dev server (electron-vite)
pnpm lint         # ESLint (flat config, must stay at 0 errors)
pnpm test         # Vitest, once (pnpm test:watch to keep it running)
pnpm typecheck    # tsc --noEmit on the node and web projects (electron-vite never checks types)
pnpm build        # Build for production
pnpm package      # Build + create Windows NSIS installer
pnpm package:linux  # AppImage
pnpm package:mac    # DMG
```

Package manager is **pnpm** (not npm or yarn). `package.json` lists `pnpm.onlyBuiltDependencies` — pnpm 10 skips postinstall scripts unless a package is on it. `electron` is deliberately **not** there: since Electron 42 the package has no postinstall and downloads its binary on first use, but electron-vite reads `node_modules/electron/path.txt` directly and fails with "Electron uninstall" if the binary is missing. That is why `pnpm dev` and `pnpm preview` run `install-electron` first (it exits at once when the binary is already there).

## Verifying Changes

A change is done when `pnpm lint` and `pnpm typecheck` report 0 errors, `pnpm test` is green and `pnpm build` compiles — checked **before committing**, not after every edit. `pnpm build` alone only proves the bundle compiles, and launching the game end-to-end needs a Microsoft account plus a Firestore modpack, so anything touching Electron or the launch is also tried by hand (`pnpm dev`, and `pnpm package` for what only shows up packaged).

**Tests** run on Vitest with their own `vitest.config.mjs` (electron-vite's config builds three targets and is not reused). They sit **next to the file they cover** (`X.test.ts` beside `X.ts`), with no `test/` folder and **no coverage target**: coverage is minimal on purpose, limited to what fails silently and what the migration rewrites. A test pins a rule of this file, not an implementation detail — and what the compiler already enforces (a phase without a slice, a channel missing from a layer) is not tested twice.

- `electron` is aliased to `src/main/testing/electron.ts`, a stub with only what the code under test touches (`safeStorage`, `app`, `powerMonitor`, `screen` — a 1080p primary display at 125%). `safeStorageControl` switches it to no keyring, an undecryptable blob or a slow encryption; reset it in `afterEach`.
- `src/main/testing/tempLauncher.ts` → `createTempLauncher()` points `ConfigManager` at a fresh temp directory on the default config, writes `config.json` and synthetic version manifests into `common/versions/**`, and `cleanup()` resets the static state. It is the one shared helper; add to it instead of starting another.
- `__MICROSOFT_CLIENT_ID__` and `__APP_VERSION__` are defined by the Vitest config, not read from `.env`.

For something a test cannot reach — a real request to Mojang, Fabric Meta or Microsoft — a throwaway script still works: bundle it with `./node_modules/.bin/esbuild ./script.mjs --bundle --platform=node --format=esm --outfile=out.mjs --alias:electron=./src/main/testing/electron.ts --banner:js="import{createRequire as __cr}from'module';const require=__cr(import.meta.url);"` and run `node out.mjs`. The script must sit inside the project (esbuild resolves dependencies from the importing file's directory). Keep it out of the repo.

## Architecture

### Process Model (Electron)

```
Main Process (src/main/)          Preload (src/preload/)       Renderer (src/renderer/src/)
├── index.ts (BrowserWindow)      └── index.ts (contextBridge)  ├── App.tsx (providers)
├── managers/                                                   ├── contexts/ (Auth, Launch, Servers, Status)
│   ├── AuthManager.ts                                          ├── services/
│   ├── ConfigManager.ts                                        │   ├── ipcClient.ts
│   ├── DistributionManager.ts                                  │   ├── launchPhases.ts
│   ├── LaunchManager.ts                                        │   ├── errors.ts (what a catch reads)
│   ├── ManifestManager.ts                                      │   ├── firebase.ts
│   ├── ModLoaderManager.ts                                     │   └── firestoreService.ts (toModpack)
│   ├── MinecraftDownloadManager.ts                             ├── hooks/
│   └── SkinManager.ts (Mojang profile, skin vault)             │   ├── useServers.ts
├── types/ (config.json, pack manifest, Mojang version JSON)    │   └── useIpcResource.ts
├── windows/msftAuth.ts (Microsoft sign-in window)              └── components/{feature}/
├── constants.ts (build-time MICROSOFT_CLIENT_ID)
└── ipc/
    ├── index.ts (the handler map)
    ├── result.ts (handle() + envelope, listen(), emit())
    ├── auth.ipc.ts
    ├── config.ipc.ts
    ├── distribution.ipc.ts
    ├── launch.ipc.ts
    ├── logs.ipc.ts (logs:export)
    ├── skins.ipc.ts (skins:*)
    └── window.ipc.ts (controls, maximize state, close guard)

Shared (src/shared/, bundled into all three)
├── channels.ts · errorCodes.ts · LauncherError.ts
├── ipcContract.ts (what every channel carries)
├── launchProgress.ts (the launch:progress union)
├── PackPolicy.ts (manifest policies and ignore globs, also run by tools/pack-publish)
├── guards.ts (shared checks and branded types: Sha256Hex, SkinId)
└── modpack.ts · skins.ts
```

### IPC Pattern

Every channel is declared once, in `src/shared/ipcContract.ts`, and the layers are typed against it: a layer that lacks a channel, or takes or returns something else for it, **does not compile**. Adding a call touches:

1. **src/shared/channels.ts** — the name: `CONFIG_SET_FULLSCREEN: 'config:setFullscreen'`
2. **src/shared/ipcContract.ts** — what it carries, in one of three contracts: `InvokeContract` (renderer → main with an answer, `[Channels.CONFIG_SET_FULLSCREEN]: (value: boolean) => void`), `SendContract` (fire and forget) or `EventContract` (main → renderer, channel → payload); plus its preload method name in `BridgeMethods`. A name in `Channels` that no contract declares fails `UndeclaredChannels`
3. **main/ipc/\*.ipc.ts** — the handler, as an entry of the map the file returns (`satisfies Partial<InvokeHandlers>`): `[Channels.CONFIG_SET_FULLSCREEN]: async (_event, value) => …`. `ipc/index.ts` spreads every file's map into one `InvokeHandlers`, which needs a handler per invoke channel, and registers it with `handleAll`. Send channels are registered with `listen()` and events go out with `emit()`, all from `ipc/result.ts` — never `ipcMain.handle`, `ipcMain.on` or `webContents.send` directly
4. **preload/index.ts** — `configSetFullscreen: invoke(Channels.CONFIG_SET_FULLSCREEN)`, in an object typed `ElectronAPI`, which needs a method for every entry of `BridgeMethods` (`UnbridgedChannels`). It imports `Channels` like the handlers do — never write a channel name as a string literal there
5. **renderer/services/ipcClient.ts** — `ipc.config.setFullscreen: invoke('configSetFullscreen')`. `UnwrappedMethods` fails if a bridge method has no wrapper

**Handler arguments arrive as `unknown`** (`Untrusted<Args>` in `result.ts`): the contract says what the renderer means to send, not what main may assume, so the handler checks type and range itself (see Trust Boundaries) before passing anything on.

**Errors cross the boundary in an envelope, never as a thrown `Error`** — Electron would serialize it to a string and lose `error.code` ([ADR-0002](docs/adr/0002-ipc-error-envelope.md)):

- Every handler goes through `handle()` from `main/ipc/result.ts`, which answers `{ ok: true, data }` or `{ ok: false, code, message }` (`IpcResult<T>`). The code is `errorCodeOf(err)`: a code that is not one of the launcher's (node's `ENOENT`) travels as `UNKNOWN`.
- `ipcClient.ts` unwraps it and rebuilds a `LauncherError` carrying `.code`, so renderer `try/catch` keeps working and callers branch on the code.
- Codes live in `src/shared/errorCodes.ts` (`ErrorCode` is the union of them), imported by **both** processes. Never compare against a literal copied into the renderer, and never branch on message text.
- **Main throws `LauncherError(code, message, cause?)`** from `src/shared/LauncherError.ts`, never an `Error` with `.code` assigned afterwards. Telling a launcher failure from a foreign one is `err instanceof LauncherError && err.code === …`.

`src/shared/` is bundled into the main, preload and renderer bundles, so anything there must stay dependency-free.

### State Management

React Context API only (no Redux). Four providers wrap the app:

- **AuthProvider** — Microsoft account, login/logout, token expiry monitoring, and `skinTexture` (the worn skin, read once per account through `skins:getActiveTexture` for the avatar; `updateSkinTexture` after a save)
- **LaunchProvider** — Launch state machine (`idle` → `preparing` → `playing`), progress tracking, the game's `startup` (`game_startup`, the tracker's last step), game logs (last 500 lines)
- **ServersProvider** — Modpack list from Firestore and the selection. The list is read on mount, on "Reintentar" and on the sidebar's refresh button (`refresh`: the list stays on screen, a failure is a toast, 30 s cooldown after a successful read, disabled while a launch is prepared), and at no other time — every read costs one Firestore read per modpack ([ADR-0016](docs/adr/0016-refresh-the-catalogue-on-demand.md)). Do not add a background or focus refresh without updating that ADR's read budget
- **StatusProvider** — Transient messages. `useStatus().showStatus(message, type)` with `type` `error` (default), `success` or `info`, shown for `VISIBLE_MS` with a bar that runs out with the timer; `dismissStatus()` closes it early (the toast's own close button). A single `<StatusMessage />` host lives in `App.tsx` above every screen, so a message raised on the way out of one screen is still visible on the next. It is the **outermost** provider, so the others (AuthProvider tells the player why a session expired) can report through it

**`useEffect` is for synchronizing with a system outside React, and nothing else** — see
[ADR-0008](docs/adr/0008-useeffect-only-for-external-systems.md). Before writing one, name the
external system it connects to: an IPC subscription, a DOM listener outside the tree, a timer,
imperative DOM the tree cannot express, or a fetch on mount. If there is no answer, it does not
get written — a value derived from props or state is computed in render, and a reaction to a
user action goes in the handler that caused it.

Every effect that stays needs all four: **cleanup** for anything it subscribes to,
**cancellation** of async work (an `ignore` flag or `AbortController` — StrictMode
double-invokes and a dependency change re-runs it), a **dependency array that matches what the
body reads**, and an **error path** that reaches the user through `useStatus()` instead of
leaving a screen stuck on "Cargando...".

**A read on mount goes through `hooks/useIpcResource`**, not a hand-written effect:
`useIpcResource(load, onError)` returns `{ data, loading, failed, reload, setData }` and carries
all four rules above. `load` is the effect's dependency, so pass a module-level function
(`ipc.config.getSettings`) or a `useCallback`; it may post-process what it gets (the skin
manager decodes its textures). `onError` is where the failure reaches the player, and is read
when the load fails, so an inline arrow is fine. `setData` is for what the screen changes
itself — an edit shown before main confirms it, or what main answered with. Used by
`AuthContext` (the stored account), `SettingsScreen` and `SkinManagerScreen`. A read keyed by
something else (the avatar's texture, per account) or that is not IPC (the Firestore
catalogue in `useServers`) keeps its own effect, with the same four rules.

### Data Sources

- **Firestore** (renderer-side via Firebase SDK) — Modpack catalogue and the manifest pointer only ([ADR-0001](docs/adr/0001-manifest-on-cdn-with-firestore-pointer.md)). Single collection: `modpacks/{id}`. There is no `modules` subcollection: file lists, per-path policies and the mod loader all live in the manifest.
  - Visual fields: `icon` (sidebar), `banner` (full-window background, **art only, no text** — it is centred on the window and cropped by `bg-cover`, so a title drawn into it never lines up with JUGAR), and the optional `logo` (transparent image rendered by `ModpackLogo`, centred in the launcher area on the play button's axis and sized to the height the button and the launch tracker leave free). All three are preloaded or rendered as soon as the list arrives. The optional `accentColor` (`#rgb`/`#rrggbb`, validated in `firestoreService.toModpack`, anything else is ignored) colours the JUGAR button, its glow and the launch tracker; without it they use `accent-orange`. Being a runtime value it is set once as the `--accent` CSS variable on `HomeScreen`'s column, never interpolated into a Tailwind class. With no modpack selected the background is a fixed grey gradient, not a photo
- **Pack manifest** (Cloudflare R2, public `r2.dev` URL) — The authority on what an instance contains. Generated by `tools/pack-publish/generate.mjs` from a modpack folder; schema and publishing flow in `docs/manifest.md`. Firestore stores its sha256, so the **manifest** only changes for players when the pointer flips. The **files** are stored by path and overwritten in place by `rclone sync`: publishing is safe only under `maintenance: true`, and rollback is a re-upload, not a pointer flip. Content addressing is proposed in [ADR-0012](docs/adr/0012-content-addressed-pack-files.md); never describe publishing as atomic until it lands.
- **RAM** — `settings.java.useModpackRam` (default `true`) decides who wins in `buildLaunchCommand`: the modpack's `java.minRam`/`maxRam`, or the launcher-wide setting. RAM crosses the IPC boundary as **megabytes** only; the `'2G'`/`'4096M'` disk format is parsed by `ConfigManager.parseRamToMB` and never reaches the renderer. The settings slider is capped at 75% of `os.totalmem()`, and `setMaxRAM` pulls `minRAM` down with it — `-Xms` above `-Xmx` aborts the JVM before it prints anything
- **ConfigManager** (main-side, persisted to `%APPDATA%/.nonamelauncher/config.json`; `~/Library/Application Support` or `~/.local/share` elsewhere) — Java settings, game resolution, selected account, auth database. The file carries a `CONFIG_VERSION` stamp; credentials are stored encrypted (see Authentication). `load()` never overwrites a file it failed to read — an unparseable one is moved to `config.json.corrupt-<timestamp>`
  - **Two roots, and they are not the same thing** ([ADR-0004](docs/adr/0004-two-roots-launcher-and-data-directory.md)). `getLauncherDirectory()` is the fixed app root and must never depend on a setting; `getDataDirectory()` is what "Directorio de datos" governs, and everything bulky hangs off it — `common/`, `instances/`, `manifests/`, `<dataDir>/runtime/<arch>`. **Build new paths on `getDataDirectory()`** unless they belong next to the config
  - `settings.launcher.dataDirectory` is `null` by default ("wherever the launcher lives"); an unusable stored path falls back to the default with a warning and is **not** rewritten
- **helios-core** — Java detection/download, Minecraft asset downloading, authentication helpers
- **Mojang profile API** (`api.minecraftservices.com/minecraft/profile`, main-side only) — the worn skin and the owned capes, and where "Gestor de Skins" saves them ([ADR-0014](docs/adr/0014-skins-through-main-as-data-urls.md)). `SkinManager` is the only caller; textures reach the renderer as `data:` URLs, never as Mojang URLs
  - The vault is `<launcherDir>/skins/` (next to the config, **not** the data directory, and shared by every account): `<sha256>.png` per skin plus `index.json` (`name`, `variant` — `null` until known, the renderer infers it —, `textureUrl`). The worn skin is matched by `textureUrl` first and by hash second, because Mojang re-encodes uploads; after an upload the entry sent claims the new URL. Every profile read adds the worn skin to the vault, so a change can never lose it
  - Import, rename and delete hit the disk at once; skin, model and cape only change with "Guardar", which sends just what differs from the profile. Delete goes to the system trash and is refused for the worn skin (`SKIN_IN_USE`). A PNG is checked by header only — 64x64 or 64x32 — in main, on import and before upload

Launcher directory layout: `common/` (shared assets, libraries, versions, java, forge), `manifests/<sha256>.json` (verified manifest cache), `instances/<serverId>/` (mods, natives, per-modpack game dir, plus `.nnl-state.json`). Under the fixed launcher root instead: `config.json`, `logs/`, `running-game.json` and `skins/`.

### Authentication

`AuthManager` runs the Microsoft → XBL → XSTS → Minecraft chain through `helios-core/microsoft`, split in two halves: `exchangeAuthCode` / `exchangeRefreshToken` obtain the Microsoft token set, and `resolveMinecraftSession(msAccessToken)` walks it down to a playable session. The three callers compose them — `addMicrosoftAccount` (both), `refreshMSToken` (both), `refreshMCToken` (only the second, since the MS token is still good). Accounts live in `config.json` under `authenticationDatabase[uuid]` with two independent expiries (`expiresAt` for the MC token, `microsoft.expires_at` for the MS token).

The three secrets — `accessToken`, `microsoft.access_token`, `microsoft.refresh_token` — are **not** on disk in the clear: `ConfigManager` folds them into one `secrets` blob encrypted with Electron's `safeStorage`, and the rest of the account stays readable. `safeStorage` needs `app.whenReady()`, which holds because `ConfigManager.load()` runs inside `createWindow()`. Only the **asynchronous** methods are used (`isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync`; the synchronous ones were removed in Electron 46), so `load()` and `save()` return promises: **await them**. A blob `decryptStringAsync` flags with `shouldReEncrypt` is rewritten on load.

Rules when touching auth ([ADR-0007](docs/adr/0007-encrypt-account-secrets-with-safestorage.md)):

- A **transient** failure (no network, 5xx) must never delete the account. helios-core does not throw for a failed request — it returns `responseStatus: ERROR` with got's `RequestError` attached — so `AuthManager.classifyRestError` reads that and tags the failure. Only a code in `TERMINAL_AUTH_CODES` (`src/shared/errorCodes.ts`, checked with `isTerminalAuthCode`) justifies a logout; an unrecognised error deliberately does **not**.
- `validateSelectedMicrosoftAccount` returns `{ ok, code, message }`, never a boolean.
- The refresh is **scheduled from `expiresAt`**, not polled: `AuthManager.startTokenRefreshScheduler` arms a `setTimeout` 5 min before expiry, bounded to `[15 s, 30 min]`, backs off `[1, 2, 5, 10 min]` on a recoverable failure and notifies the renderer only on a terminal one. Starting is idempotent, and `powerMonitor.on('resume')` re-checks after a suspend. Re-arm it with `scheduleTokenRefresh()` after anything that changes the selected account.
- Never send the Minecraft `accessToken` to the renderer; the renderer only needs `username`/`uuid`/`displayName`.
- The Microsoft sign-in window runs in its own **in-memory** partition (`msft-auth` in `windows/msftAuth.ts`), never in the default session, and the logout handler empties it. Microsoft's cookies are a live web session for the player's account: they must not reach the disk nor outlive a logout. `purgeLegacyAuthCookies` removes the ones older versions left in the default session.
- `microsoft.expires_at` is the expiry of the MS **access** token (~1 h), not of the refresh token (~90 days). Never treat it as "the session is over".
- A decryption failure costs the session only: `purgeSession` clears `authenticationDatabase` and `selectedAccount` and leaves every setting alone. If `safeStorage.isEncryptionAvailable()` is false, credentials are **not persisted at all** rather than written in plaintext.
- `usersAllowed` filtering in `firestoreService` is UX only ([ADR-0006](docs/adr/0006-usersallowed-is-ux-not-access-control.md)), and cannot currently be enforced in Security Rules either — the launcher has no Firebase identity, so `request.auth` is always `null`. See the stand-by entry in `TODO.md`.

### Firestore → Main Process Bridge

Firestore data is fetched in the renderer, then sent to main via `distro:setServerData`. DistributionManager.setServerData() wraps it as `{ rawServer }`.

The document is checked twice, by the same rules: `firestoreService.toModpack` turns it into a `Modpack` for the UI (an optional field of the wrong type is dropped, a missing `name` becomes the id), and `DistributionManager.parseServerData` checks main's own subset again, since nothing that crosses the IPC boundary is trusted.

The renderer re-reads the modpack document in `useServers.prepareLaunch()` **when PLAY is pressed**, not when the list loads — otherwise a player who left the launcher open would never see a `maintenance` flag raised afterwards, nor a manifest published in the meantime. The fresh copy must pass the catalogue's own rule, `services/modpackVisibility.isVisibleTo` (public, enabled, `usersAllowed`), which `getModpacks` applies too, so a modpack withdrawn in the meantime cannot launch from the stale list. `LaunchManager` checks `maintenance` again as defence in depth; visibility is not repeated there, since only the fresh copy can carry it as false and it never reaches main.

### Launch Flow (`LaunchManager.launchMinecraft`)

Every step reports through a single `progressCallback`; the renderer maps `type` to UI state in `LaunchContext`.

```
auth (validate/refresh MS token)
  → manifest        (ManifestManager.fetch — sha256-verified against the Firestore pointer)
  → validation      (DistributionManager.planSync — sha256 per file, size+mtime fast path)
  → download_mods   (DistributionManager.applySync — orphan deletion + helios downloadQueue)
  → download        (MinecraftDownloadManager — helios MojangIndexProcessor, returns the version manifest)
  → java            (LaunchManager.ensureJava — validate → discover → download)
  → modloader       (ModLoaderManager.installModLoader — Forge installer / Fabric Meta profile)
  → download_libraries (LaunchManager.downloadModLoaderLibraries — loader-specific libs)
  → launch          (buildLaunchCommand + child_process.spawn, detached)
  → started → game_startup (tracker's last step) / stdout / stderr → exit
```

`started` is emitted on the child's `spawn` event (`LaunchManager.waitForSpawn`), never right
after calling `spawn()`: a missing `javaw` only surfaces afterwards, and it must fail the launch
through the normal `catch` (`GAME_SPAWN_FAILED`) instead of showing "playing" first.

**The game outlives the launcher** ([ADR-0013](docs/adr/0013-the-game-outlives-the-launcher.md)).
It is spawned with `detached: true`: without it Windows puts the child in libuv's kill-on-close
job object and closing the launcher killed the game unsaved (measured). On quit,
`LaunchManager.releaseGame()` (`will-quit`) only destroys the pipes and `unref()`s the child.
`running-game.json` next to `config.json` records `{ pid, gameDir }` from spawn to `close`;
`findOrphanGame()` treats the record as live only if that PID's command line still contains the
`gameDir`, and a launch (or a data directory change) over a live one is refused. Closing the
window while a launch is being **prepared** is held in main (`window.ipc.ts`) and confirmed by
`CloseGuard` in the renderer; with a game running it closes without asking. Do not set
`windowsHide: true` on the game spawn: Windows applies it to the JVM's first window, which is the
game's.

Game output is read **by lines** (`utils/GameOutput.readLines`, before any trim — a chunk can end
mid-line), forwarded as `{ type: 'stdout' | 'stderr', lines: string[] }`, and fed to
`utils/StartupTracker`, which turns milestones in the log into `game_startup`. The milestone table
is heuristic and only calibrated against Fabric 1.20.x; the bar starts indeterminate, finishes
after a quiet period past the late milestones, and gives up after 3 minutes. The tracker latches
once `done` and is reset together with `gameProcess = null`.

Arguments and libraries are filtered by `LaunchManager.rulesAllow`, which follows Mojang's
semantics — with rules an entry starts **disallowed** and the **last** matching rule wins;
`os.name`, `os.arch` and `os.version` are all checked. A placeholder with no value in
`argContext` is never passed literally: the argument is dropped, and a bare `${x}` takes the
`--flag` in front of it along (this is how `--clientId`/`--xuid` disappear).

`--width`/`--height` come from `LaunchManager.gameResolution()`: Ajustes' resolution when
windowed, and the primary monitor's current mode in fullscreen (physical pixels; points on
macOS). Minecraft creates its fullscreen window at that size and GLFW switches the monitor to
the closest video mode, so any other size changes the player's screen mode and rearranges their
windows. Do not drop the flags in fullscreen either: the game would fall back to 854×480.

Invariants to preserve when touching this flow:

- **Only one launch at a time.** `LaunchManager.launchInProgress` guards the preparation and `gameProcess != null` guards the rest; a second call is rejected with `LAUNCH_ALREADY_RUNNING` **before** the try, so it never emits `{type:'error'}` and tears down the UI of the launch that is actually running. `killGame()` does not clear `gameProcess` — the `close` handler is the only place that does. The renderer resynchronises after a reload through `launch:getStatus`

- **Java must exist before any step that spawns a JVM.** The Forge installer needs one, which is why `ensureJava` runs before `installModLoader`.
- The version string used for launching is `ModLoaderManager.getVersionString(manifest.loader, minecraftVersion)` (`1.20.1-forge-47.2.0`, `fabric-loader-x-y`, or the plain MC version); the *vanilla* version (`manifest.minecraft.version`) is what Mojang downloads and the client jar are keyed by. `loadVersionManifest` returns both — do not conflate them.
- **The manifest is authoritative for launching.** `minecraftVersion` on the Firestore document is display-only — and currently displayed nowhere, since the caption under JUGAR shows only the name; never launch from it. Technical details (pack version, loader, mod list) are deliberately not shown to players: they are content creators, not modpack maintainers.
- Never synthesize an empty `arguments` object when merging manifests: an empty array is truthy and silently disables the fallback branches.
- Classpath entries are deduplicated by `group:artifact[:classifier]` and the loader's declaration wins over vanilla's.
- Libraries come in two shapes — Mojang/Forge `downloads.artifact`, Fabric Maven `name` + `url`. Always go through `LaunchManager.resolveLibraryArtifact`, never read `downloads.artifact` directly.

**Supported range: Minecraft 1.17+** ([ADR-0003](docs/adr/0003-minecraft-1-17-minimum.md)). `assertSupportedVersion` rejects anything older with `UNSUPPORTED_MC_VERSION`. Do not add half-support: older versions need natives extraction and the `minecraftArguments` path together, or not at all.

#### Progress event contract ([ADR-0005](docs/adr/0005-single-progress-contract-and-phase-map.md))

Every callback in the chain takes **one object**, `{ current, total, message }`. The managers underneath do not know which launch phase they are serving, so they never set `type`; `LaunchManager` is the only layer that adds it. `MinecraftDownloadManager` also carries its own sub-phase as `phase`.

`launch:progress` carries `LaunchProgress` (`src/shared/launchProgress.ts`), a **discriminated union** on `type`: one event shape per group below, and `LaunchManager`'s callback is typed against it. A preparation phase is a `PhaseType`, and `PHASE_RANGE` / `PHASE_LABEL` in `renderer/services/launchPhases.ts` are `Record<PhaseType, …>`, so a phase without a slice **does not compile**. Nor does a `type` without its `case` in `LaunchContext`'s switch, whose `default` assigns the event to `never` — without the case the step would run with the bar frozen on the previous message. Current set:

| Group | Types |
|-------|-------|
| Phases (update the progress bar) | `auth`, `manifest`, `validation`, `download_mods`, `download`, `java`, `java_discover`, `java_download`, `java_extract`, `modloader`, `download_libraries`, `launch` |
| Lifecycle | `started`, `exit`, `error` |
| Game startup (the tracker's last step, `{ current, total, message, done }`, `current` null = indeterminate) | `game_startup` |
| Game output (appended to the log viewer, `lines: string[]`) | `stdout`, `stderr` |

Adding a phase means touching `PhaseType`, `LaunchManager`, `LaunchContext` **and** `launchPhases.ts` in the same change. A `type` must appear **exactly once** in the flow — `PHASE_RANGE` maps it to a fixed slice, so a repeated type makes the bar run backwards ([ADR-0005](docs/adr/0005-single-progress-contract-and-phase-map.md)). `game_startup` is the one deliberate exception: it repeats, and it has **no** slice in `PHASE_RANGE` because it drives the last step on its own 0–100 scale after the preparation is at 100% (`STARTUP_LABEL` in `launchPhases.ts`).

The player sees **one** bar, `components/launch/ProgressBar.tsx`, split into the four points of `LAUNCH_STEPS` (Verificar, Descargar, Preparar, Iniciar): the stretch of the step in progress fills 0–100 and the ones behind it are checked. The preparation steps are **cuts across `PHASE_RANGE`** (`until`, which must fall on a phase boundary), not weights of their own, and `launchStep(type, percent)` places a phase by the step its floor falls in — so a new phase with a slice joins a step without a third table. Phases a launch skips just never arrive; their step is checked when a later one starts. `progress.type` is what places an event on the tracker; `progress.phase` is only the header text.

#### Mod loader installation

helios-core does **not** install mod loaders — it only reads a version manifest that the distribution already provides. The loader is declared by the manifest (`loader: { type, version }`) and read there and nowhere else. Everything below is ours:

- **Fabric** — no installer: the profile JSON is fetched from `meta.fabricmc.net` and written to `versions/<id>`. This is the only loader currently exercised end to end.
- **Forge** — the installer jar would be published as an ordinary manifest file (`loader.installer.path`) and `ModLoaderManager.installForge` runs it (`--installClient <commonDir>`), generating the version JSON and running its binary-patching processors. Needs a JVM and `launcher_profiles.json`, both handled. **Not reachable today**: `tools/pack-publish` refuses non-Fabric packs, so this path has never run. Wire the generator before trusting it.
- **NeoForge (planned)** — its installer is a fork of Forge's and accepts the same `--installClient`, so `installForge` works as-is; only the maven host (`maven.neoforged.net`) changes. The trap is the version id: `neoforge-21.1.72` for MC 1.20.2+, but `1.20.1-forge-47.1.106` for MC 1.20.1. Read `id` from `version.json` inside the installer jar instead of composing it from a template. `adm-zip` was dropped on 2026-11-05 because nothing imported it; add it back with NeoForge.

### Java Handling

`helios-core/java` (v2.3 API — check signatures before use, they changed in 2.x):

- `validateSelectedJvm(rootDir, semverRange)` → `JvmDetails | null` (not `{ valid }`); pass a **root** dir via `ensureJavaDirIsRoot`, not the executable.
- `discoverBestJvmInstallation(dataDir, semverRange)` scans system installs **and** `<dataDir>/runtime/<arch>`.
- `latestOpenJDK(major, dataDir)` returns an `Asset` with `url`, `hash` (SHA256) and the `path` where it should land — use that `path` so downloaded JDKs live in the runtime dir and get rediscovered later.
- `extractJdk(archivePath)` extracts next to the archive and returns the executable path (`javaw.exe` on Windows).

The required Java major comes from the Mojang manifest (`javaVersion.majorVersion`), which `MinecraftDownloadManager.downloadMinecraft` returns; the MC→Java table in `getRequiredJavaVersion` is only a fallback. Ranges are bounded (`17.x`, not `>=17`) so a modpack built for 17 is never launched on 21.

`ensureJava` keeps the player's choice and the launcher's own apart (config v2):

- `settings.java.executable` is **only** what the player picked in Ajustes. When set it is used
  if it satisfies the major and the launch stops with `JAVA_MANUAL_INCOMPATIBLE` if not — it is
  never replaced or overwritten. The v1 → v2 migration clears it, because a v1 value cannot tell
  a choice from a leftover of auto-detection.
- `settings.java.runtimes` caches what the launcher found or downloaded, keyed by major
  (`{ "17": …, "21": … }`). Order: manual → cached runtime → `discoverJava` → `downloadJava`
  (only if `autoDownload`). Discovery runs even with auto-download off.
- Pass executables through `LaunchManager.javaRoot()`, not `ensureJavaDirIsRoot` directly: helios
  only recognises the platform separator, so `C:/…/javaw.exe` never validated.

### Shared Utilities (`src/main/utils`)

- `Logger` — one winston root logger; `getLogger(name)` returns a child labelled with the name. Console transport (coloured) plus, after `Logger.enableFileLogging(ConfigManager.getLogsDirectory())` in `main/index.ts`, a file transport at `<launcherDir>/logs/launcher.log` rotating at 5 MB × 5 files. An `Error` argument is rendered as stack + `code` + cause chain (never `util.inspect` at unlimited depth, which dumped got's request headers), other objects at depth 3, and the final line goes through a token redactor. The redactor is a safety net: **never log a token, nor an object that may carry one**. helios-core's own internal loggers still use its console-only `LoggerUtil`.
- `FileUtils` — `hashFile` / `validateLocalFile`, streaming. Every downloaded artifact is validated with it; never re-implement hashing with `readFileSync`. `validateLocalFile` with no expected hash accepts **any file that exists**, and helios writes downloads straight to their final path. So never pass it a null hash if one can be obtained: loader libraries without `sha1` (Fabric's `fabric-loader` and `intermediary`) get theirs from the maven via `LaunchManager.fetchPublishedSha1`. `writeFileAtomicSync` (tmp + fsync + rename) is the one atomic writer, shared by `config.json` and the skin vault.
- `PathUtils` — `resolveInside` / `isSafeRelativePath`. Every path built from manifest, renderer or network data goes through `resolveInside`.
- `HttpUtils` — `fetchWithTimeout` for small JSON/text requests. Never call bare `fetch` in main.
- `MavenUtils` — `mavenToRelativePath` / `mavenToUrl` for Maven-coordinate libraries.
- `GameOutput` — `readLines(stream, onLines)`: whole lines from a child's stdout/stderr, one callback per chunk.
- `StartupTracker` — `STARTUP_MILESTONES` and `createStartupTracker(report)`, the heuristic behind the `game_startup` bar.
- `PackPolicy` lives in **`src/shared/PackPolicy.ts`**, not here — `globToRegExp` / `compileIgnore` / `resolvePolicy` / `strictRoots` for manifest ignore globs and per-path policies, plus the `FilePolicy`/`PolicyRule` types. It is the one copy: `tools/pack-publish/generate.mjs` imports the same file on plain node through native type stripping (Node 22.18+), so it takes **no runtime import** (only `import type`), only erasable syntax (`erasableSyntaxOnly` in `tsconfig.node.json`) and no build-time global. `PackPolicy.test.ts` loads it on plain node to catch a break before publishing day.

The data shapes main reads from disk and the network live in `src/main/types/` — `config.ts` (`config.json`, in memory and as written), `manifest.ts` (the pack manifest) and `minecraft.ts` (Mojang version JSON and Fabric's profile, only the fields that are read). They are types, not proof: what arrives as `unknown` becomes one of them through a guard (`ManifestManager.assertShape`, `ConfigManager.validateConfig`, `DistributionManager.parseServerData`, `SkinManager.parseProfile`), never through a bare cast.

## Styling

Tailwind CSS v4 with `@theme` block in `App.css`. Key custom tokens:

- Colors: `accent-green` (#4ade80), `accent-blue`, `accent-wine` (#7a1f3d, the kill button's hover), `accent-orange` (#d87943, the Microsoft sign-in button's hover and JUGAR's default), `bg-deep` (#050505), `panel-steel`, `sidebar-bg`, `sidebar-border`, `card-hover`
- Fonts: `font-inter` only. **The theme key is `--font-inter`, not `--font-family-inter`** — Tailwind v4 namespaces families under `--font-*`, and a token in a namespace that does not exist generates no class and reports nothing. Inter is **self-hosted** through `@fontsource-variable/inter` (imported in `main.tsx`, family name `'Inter Variable'`); never reintroduce a CDN `@import`, `style-src` blocks it
- Animation: `animate-blink` (cursor blink), `animate-fade-in-up` (modpack logo and JUGAR on mount, pair it with `motion-reduce:animate-none`). The background crossfade is a plain opacity/scale transition in `DynamicBackground`, not a keyframe

UI follows dark glassmorphism, in two flavours:

- **Opaque surfaces** (dropdowns): `bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border border-white/10`
- **Status toasts are the one light surface**: a tinted card per type (`bg-red-100`/`green-100`/`blue-100` with the matching border), a round badge with the icon, dark text, a close button and a countdown bar whose duration comes from `StatusContext` (`toast-timer` keyframe in `App.css`), so bar and timer cannot drift apart
- **Over the banner** (launch tracker, "Mostrar Logs"): `bg-black/35 backdrop-blur-md border border-white/10`, since they sit on artwork with no scrim behind them
- **The modal** (`components/common/Modal.tsx`): panel at `bg-[rgba(18,18,20,0.55)] backdrop-blur-[28px] backdrop-saturate-150` over an overlay that is only `bg-black/25` with **no blur of its own**. `backdrop-filter` blurs everything painted behind the element, the overlay's background included, so putting a solid scrim on the overlay leaves the panel blurring a flat wash and the glass disappears. Extra header controls go in its `actions` prop (the log viewer's Copiar/Guardar)

The window is **frameless** (`frame: false`): `components/common/TitleBar.tsx` is the title bar, a
drag region (`[-webkit-app-region:drag]`, buttons opt out with `no-drag`) that sits at `z-[60]`,
above the modal overlay, so the window stays movable and closable with a dialog open. `App.tsx`
gives it the first row and the screens fill the rest — size screens with `h-full`/`w-full`,
**never `h-screen`**, or they overflow the window by the bar's height. The Microsoft sign-in
window keeps its native frame.

The window opens at 1000×600 and cannot shrink below **900×560** (`minWidth`/`minHeight` in
`main/index.ts`), which still fits a 720p screen — or 1080p at 150% scaling — with the taskbar.
Lay screens out for that minimum, not for the default.

Ajustes (`components/settings/SettingsScreen.tsx`) is **one category at a time**: a vertical
tablist on the left (Juego, Java, Launcher, opening on Juego) and the open tab on the right. The
window is wider than it is tall, so the tabs spend width instead of height, and no tab scrolls at
the minimum size; the panel's `overflow-y-auto` is only a safety net. Only the open tab is
mounted, which is safe because the typed values commit on blur. A new category is an entry in
`TABS`, and one that would not fit 900×560 is split rather than scrolled.

The home screen with a modpack selected is **one flex column**, all in the flow: the logo box
(`flex-1 min-h-0`, so `ModpackLogo` scales down into whatever height is left), JUGAR, and a slot
of fixed height for the launch tracker that stays reserved while empty, so pressing JUGAR does
not shrink the logo. Do not go back to `absolute` offsets from the bottom: that is how the second
bar came to cover JUGAR and its kill button, and how the logo got pinned at 110px in the default
1000×600 window. JUGAR and the kill button size themselves with `clamp()` against the viewport.
"Mostrar Logs" lives outside the column, in the bottom-left corner next to the sidebar.

The brand logo (raccoon + "NONAME LAUNCHER", white on transparent) is
`assets/imgs/nonamelauncher-logo.png`, rendered through `components/common/AppLogo.tsx` on the
loading and login screens and the home screen with no modpack selected; size it with a width. The window/app icon is still `resources/icon.png`.

## Environment Variables

All of them are read **at build time** from `.env` (or the environment, which wins); the running app never reads `.env` and `dotenv` is gone. Firebase config uses the `VITE_` prefix (inlined into the renderer). `MICROSOFT_CLIENT_ID` is validated and inlined into main by `electron.vite.config.mjs` as `__MICROSOFT_CLIENT_ID__`, read only through `src/main/constants.ts`; `pnpm dev`/`pnpm build` stop if it is missing or not an Azure GUID.

```
MICROSOFT_CLIENT_ID=...
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
```

## Key Conventions

- All UI text is in **Spanish**; logs and code identifiers in English
- Managers are static classes (no instantiation)
- IPC channel names use colon notation: `category:action`
- The avatar is drawn from the worn skin texture (`components/common/SkinHead.tsx`, CSS only); minotar.net is gone ([ADR-0014](docs/adr/0014-skins-through-main-as-data-urls.md))
- `usersAllowed` in Firestore filters by Minecraft **username** (not UUID)
- **Everything under `src/` is TypeScript** (`.ts`/`.tsx`), [ADR-0015](docs/adr/0015-incremental-typescript-migration.md): `strict` plus `noUncheckedIndexedAccess`, and no `allowJs`, so a `.js` file there does not even compile. An index that may be missing (a regex group, a split, a list from a manifest) gets a guard or a default, not a `!`; there is no `any`, `@ts-expect-error` or non-null assertion in the tree, and the few `as unknown as` say why next to them
- **Untrusted values that end up in a path carry a brand** (`Brand<…>` in `src/shared/guards.ts`): `Sha256Hex` (manifest and file hashes), `SkinId` (vault ids) and `ModpackId` (`DistributionManager`). The guard (`isSha256Hex`, `isSkinId`, `parseModpackId`) is the only way to get one, so a function that takes it cannot receive a value nobody checked. Brands stay in main where the contract carries a `string`. Do not brand everything: paths and usernames stay `string`. The common checks (`isPlainObject`, `isOptional`, `nonEmptyText`) live in the same file — never copy them into a module again
- **Closed unions get exhaustive switches**: a `default` that assigns to `never` (`LaunchContext`, `ModLoaderManager.unsupportedLoader`), so a new member does not compile until every switch handles it. The manifest's `loader.type` is `'fabric' | 'forge'`, refused otherwise by `assertShape` (`UNSUPPORTED_MODLOADER`)
- In the renderer, a `catch` reads what it caught through `services/errors`: `errorMessage(err, fallback)` for the text and `isTerminalAuthError(err)` for "the session is gone", never `err.message` or `err.code` on an `unknown`
- Indentation: 4 spaces in `src/main/{managers,utils,windows,testing,types}`, 2 spaces in the files at the root of `src/main` (`index`, `constants`, `env.d.ts`), `src/main/ipc`, `src/preload`, `src/shared` and the whole renderer. Match the file you are editing
- Error codes are shared constants in `src/shared/errorCodes.ts`, never inline strings, and main throws them as `LauncherError`

## Implementation Principles

**DRY** — one mechanism per job.

- Downloads go through `helios-core/dl` (`downloadQueue`, `downloadFile`): it already does retries and concurrency. Do not add another `got.stream` + `createWriteStream` loop — `got` is intentionally not a direct dependency anymore.
- Mod-loader knowledge (detect type, resolve version, build version string) lives in `ModLoaderManager` only.
- Constants shared by main and renderer (client id, launcher name/version) come from a single source, not per-file fallbacks. The launcher version is `package.json`, not a literal: the main process reads `app.getName()` / `app.getVersion()`, and the renderer gets `__APP_VERSION__`, inlined at build time by `electron.vite.config.mjs` because it is sandboxed and cannot read the file.
- Adding an IPC call means touching every layer (channels → contract → handler → preload → ipcClient); the contract in `ipcContract.ts` makes a missing one a compile error rather than a dead channel.

**KISS** — the launcher is a pipeline, keep it readable.

- Prefer small named steps over a single long function with flags. Mode parameters that change the meaning of the other arguments are a smell — split the function, the way `fullMicrosoftAuthFlow(code, authMode)` became `exchangeAuthCode` / `exchangeRefreshToken` / `resolveMinecraftSession`.
- One progress-reporting shape for the whole chain: a single `{ current, total, message }` object. Do not add a `(current, total, msg)` signature back.
- Fail loudly: never swallow a per-file download error with a `logger.warn` and continue into launch.

**YAGNI** — delete instead of keeping "just in case".

- The distribution.json path and `DownloadManager` are **gone**, along with `auth/PlayerInfo.jsx` and `server/ServerSelector.jsx`. `distro:setServerData` is the only distribution channel left. Do not reintroduce them.
- Genuinely unused deps should be removed, not extended — but check what actually loads them first. `helios-distribution-types` looks unused because nothing in `src/` imports it; it is required at runtime by `helios-core/common` (→ `DistributionAPI` → `DistributionFactory`), which `AuthManager` imports for `RestResponseStatus`. helios-core only declares it as a **devDependency**, so the consumer has to provide it. Removing it once left the app unable to start from a clean install, and it stayed hidden for weeks because the existing `node_modules` still had the package on disk.
- No new abstraction layer until there is a second caller.

## Trust Boundaries and Known Gaps

Treat two things as **untrusted input in the main process**: every argument that arrives over
IPC (the renderer is sandboxed, but it is still the side an attacker reaches first), and every
value that came from the network — the Firestore document, the manifest, Fabric Meta, Mojang
version JSON. Hashes prove a file is the published one; they do not prove its contents are
sane.

For **new code** this means: validate type and range in the handler, not only in the UI; resolve
every path built from such data inside its base directory and throw if it escapes (the orphan
deletion in `DistributionManager.applySync` is the model); give every network `fetch` a timeout.

The mechanisms for this exist and are the ones to reuse (branch `fix/p1-hardening`):

- **Paths**: `PathUtils.resolveInside(base, rel)` throws `PATH_OUTSIDE_BASE`, and
  `isSafeRelativePath` is the manifest-path rule. `ManifestManager.assertShape` rejects unsafe
  paths with `MANIFEST_INVALID`, `DistributionManager.parseModpackId(id)` validates modpack ids
  (`MODPACK_INVALID`) and is the only source of the `ModpackId` that `instanceDirFor` takes, and `ConfigManager.getVersionDirectory/getVersionJsonPath` is the only way
  to build `versions/<id>`
- **Network**: `HttpUtils.fetchWithTimeout(url, what, { timeoutMs })` for JSON/text requests
  (`NETWORK_TIMEOUT` / `NETWORK_ERROR`); files still go through `helios-core/dl`
- **Settings**: `config.ipc.ts` validates every setter (`CONFIG_INVALID_VALUE`), and
  `setJavaExecutable` only accepts an existing, absolute `java`/`javaw`
- **Persistence**: `ConfigManager.save()` is atomic (tmp + fsync + rename), asynchronous and
  **rejects** with `CONFIG_SAVE_FAILED`, so callers must `await` it and let it propagate or
  handle it; only `load()` uses the swallowing `saveAfterLoad()`. Saves are serialized: each
  waits for the previous one and encodes the config as it is when its turn comes, so an older
  state can never land on top of a newer one. `validateConfig` repairs wrong-typed keys one by
  one, and a non-object root is quarantined
- **Auth**: `validateSelectedMicrosoftAccount()` is single-flight (`validationInFlight`); the
  body is `runAccountValidation()`
- **Dev mode**: the dev renderer URL, DevTools and the relaxed CSP are gated on `app.isPackaged`
- **Shell**: the renderer can only open the data and logs directories
  (`shell:openDataDirectory`, `shell:openLogsDirectory`, no argument)
- **Single instance**: `main/index.ts` takes `app.requestSingleInstanceLock()` before anything
  else; a second launch focuses the existing window and exits, so `config.json` and the log file
  only ever have one writer
- **Settings in the renderer**: `SettingsScreen.saveSettings(changes, persist, message)` shows the
  change, awaits the IPC call and reverts with a status message if main rejects or cannot save
  it. Never call `ipc.config.set*` fire-and-forget; typed values (resolution, RAM) are committed
  on blur, not per keystroke
- **Exported logs**: `logs:export` takes the text from the renderer but never a path — the path is
  whatever the native save dialog answered — and writes it through `Logger.redact`
- **Skins**: same rule for `skins:import`, whose path comes from the native open dialog;
  `skins.ipc.ts` checks vault ids (`/^[0-9a-f]{64}$/`), names (`cleanSkinName`, 32 chars) and the
  save choice. Profile bodies are parsed by `SkinManager.parseProfile`, and a texture URL is only
  followed on `textures.minecraft.net`, over https
- **Process probing**: `LaunchManager.readCommandLine(pid)` interpolates the PID into a PowerShell
  command, so it is only ever called with a PID already checked to be a positive integer

Still open from the 2026-09-17 audit, all in `TODO.md`: B16 (cache pruning) and S7 (PKCE), plus
B1 (publishing), on hold because it changes the bucket.

## Gotchas

- `helios-core` 2.x changed several signatures (see Java Handling). Read `node_modules/helios-core/dist/**/*.d.ts` before assuming an API shape.
- `resources/icon.png` is the studio icon (1024×1024, transparent) and the app icon for every target. `resources/` is electron-vite's **public directory** for main: `import icon from '…/icon.png?asset&asarUnpack'` does not copy the file, it resolves to `../../resources/icon.png` next to the bundle (rewritten to `app.asar.unpacked`). That is why `electron-builder.yml` lists it under both `files` and `asarUnpack` — `buildResources` is excluded from the app otherwise, and the window icon would point at nothing.
- `.env` is not bundled into the packaged app and nothing reads it at runtime. Anything the main process needs from it goes through a `define` in `electron.vite.config.mjs`, the way `__APP_VERSION__` and `__MICROSOFT_CLIENT_ID__` are done (declare the global in `eslint.config.mjs` and in the matching `env.d.ts` too).
- Only packages the **main process** `require`s at runtime belong in `dependencies` (`fs-extra`, `helios-core`, `helios-distribution-types`, `winston`) — `externalizeDepsPlugin` leaves exactly those out of the bundle and electron-builder ships them. Build-only tooling goes in `devDependencies`. `pnpm audit --prod` should stay at 0.
- The working tree is CRLF (`core.autocrlf=true`). Scripted edits must match `\r\n`, and a `\uXXXX` escape typed into a tool call can arrive as the literal character — check regexes like `/^\uFEFF/` after writing them.
- TypeScript is pinned to **6.0.x** (`~6.0.3`): `typescript-eslint` 8 supports `<6.1`, and TypeScript 7 (the native compiler, `latest` on npm) has no API it can use yet. Do not bump it on its own. TypeScript 6 also defaults `types` to `[]`, which is why both tsconfigs list theirs explicitly (`node` for main, `vite/client` for the renderer).
- Build-time globals are declared twice on purpose: for ESLint in `eslint.config.mjs` and for the type checker in `src/main/env.d.ts` / `src/renderer/src/env.d.ts`. A new `define` in `electron.vite.config.mjs` goes in both, and in `vitest.config.mjs` if tested code reads it. `window.electronAPI` is typed in the renderer's `env.d.ts` as the contract's `ElectronAPI`.
- The renderer's entry is `index.html` in its `root` (`src/renderer`), found by vite on its own. Do not add `build.rollupOptions.input` back: written as `./src/renderer/index.html` it resolved against that root, the dev dependency scan failed, and deps were pre-bundled on the fly with two copies of React ("Invalid hook call"). vite 8 bundles with Rolldown; `rollupOptions` is only an alias of `rolldownOptions` now.
- Since Electron 43 a file dialog with no `defaultPath` opens in Downloads, not where the OS last left it. Pass one when there is an obvious starting point (the data directory picker starts at the current data directory).
- The sandboxed preload (Electron 45+) can only `require('electron')`, and has no `Buffer`, `setImmediate` or Node shims. Use Web APIs there.
- `pnpm-lock.yaml` is the only lockfile; the stale `package-lock.json` has been removed.
- `src/shared/package.json` (`{ "type": "module" }`) is not a stray file. The root `package.json` declares no module type (that is the ESM item in `TODO.md`), so plain node warns `MODULE_TYPELESS_PACKAGE_JSON` every time `tools/pack-publish` loads `PackPolicy.ts`; declaring `src/shared` ESM silences it. electron-vite, tsc and Vitest ignore it. `PackPolicy.test.ts` fails if the warning comes back.
- Node 22.18+ is the floor: Vitest 5 needs 22.12, and `tools/pack-publish` needs type stripping on by default (`generate.mjs` stops with a message on an older Node).
- The renderer reads Firestore through `firebase/firestore/lite` (REST, no realtime, no offline queue); the initial chunk is ~1.0 MB (Firebase 13's lite build carries Firestore's BSON and vector types, which tree-shaking cannot drop). Do not import from `firebase/firestore`: it pulls the full SDK back in (~320 KB more) for nothing, since only one-off `getDoc`/`getDocs` reads are made. Lite has no request deadline, so the timeout race in `firestoreService` stays ([ADR-0009](docs/adr/0009-no-offline-mode.md)).
- The skin manager is a **lazy chunk** (`React.lazy` in `HomeScreen`, ~900 KB minified, almost all three.js via `skinview3d`). Anything the home screen imports must not reach `skinview3d` or `skinview-utils`, or the chunk folds back into the initial bundle — that is why `SkinHead` carries its own CSS instead of importing `services/skinTextures.ts`. The same holds for `SkinManagerSkeleton` (the Suspense fallback **and** the screen's own loading state, so loading is one continuous skeleton), the `SkinManagerLayout` frame it shares with the screen, `SkinCard` and `common/Spinner`, which all end up in the initial bundle. `skinview3d` pins three.js `^0.156`; check its release before bumping three on its own.

## Commits

Conventional Commits in **English**, one short subject line, one logical change per commit. No body unless it is genuinely needed, and **never a `Co-Authored-By` trailer**:

```
feat(launch): use per-modpack RAM settings
fix(java): read required version from manifest
refactor(distro): drop the distribution.json flow
build: add portable Windows target
```

Scopes in use: `launch`, `java`, `auth`, `distro`, `servers`, `download`, `game`, `fabric`, `ui`, `config`, `skins`.

(UI text stays in Spanish — this rule is only about commits, code identifiers and logs.)
