# NoNameLauncher

A custom Minecraft launcher built with Electron, React, and Tailwind CSS. Features Microsoft authentication, Firestore-based modpack distribution with per-user visibility lists, and automatic Java management.

<!-- ![NoNameLauncher Screenshot](docs/screenshot.png) -->

## Features

- **Microsoft Authentication** — Full OAuth flow with automatic token refresh
- **Modpack Distribution** — Catalogue in Firebase Firestore, files on a CDN verified by sha256. Per-user visibility lists hide packs in the UI; they are **not** access control (see below)
- **Automatic Java Management** — Reads the required Java version from the Minecraft manifest, reuses a compatible JVM if one is installed, downloads it otherwise. A Java picked by hand in Settings is always respected: a modpack that needs another version refuses to start instead of silently switching
- **Fabric Support** — Loader profile resolved from the Fabric Meta API. Forge is implemented but not yet reachable end to end (see the loader table below)
- **Per-Modpack Settings** — RAM allocation defined per modpack, used by default; a launcher-wide slider takes over when the per-modpack override is switched off in Settings
- **Skin Manager** — A 3D viewer of the account's skin, a local vault of skins imported from PNG files (rename and delete from the right-click menu), classic or slim model, and the capes the account owns; "Guardar" applies the change on Mojang (see [ADR-0014](docs/adr/0014-skins-through-main-as-data-urls.md))
- **Dynamic UI** — Modpack banners, the player's head drawn from their own skin, glassmorphism dark theme with its own title bar
- **Launch Feedback** — One progress bar split into steps (verify, download, prepare, start), each checked as the launch moves past it, the last one following the game to its title screen; the game log can be copied or saved from the logs dialog
- **The Game Outlives the Launcher** — Closing the launcher never closes Minecraft; closing it mid-download asks first (see [ADR-0013](docs/adr/0013-the-game-outlives-the-launcher.md))
- **Cross-Platform** — Windows (NSIS installer + portable), Linux (AppImage), macOS (DMG)

## Supported Minecraft Versions

**Minecraft 1.17 and newer.** Older releases use a different manifest format (`minecraftArguments`) and ship natives as library classifiers that must be extracted manually; that path is intentionally not implemented. Selecting a modpack below 1.17 fails with an explicit error instead of launching a broken game.

| Loader | Status |
|--------|--------|
| Vanilla | Supported |
| Fabric (1.17+) | **Supported** — profile resolved from `meta.fabricmc.net`, exercised end to end |
| Forge (1.17+) | **Implemented, unverified** — `ModLoaderManager.installForge` runs the official installer, but `tools/pack-publish` refuses non-Fabric packs, so no pack using it can be published yet |
| NeoForge | Planned |
| Minecraft ≤ 1.16 | Not supported |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 45 |
| Frontend | React 19, Tailwind CSS v4 |
| Build | electron-vite, electron-builder |
| Backend | Firebase Firestore |
| Game Engine | [helios-core](https://github.com/dscalzi/helios-core) 2.x — signatures changed in 2.x, check `node_modules/helios-core/dist/**/*.d.ts` |
| Auth | Microsoft Azure AD (OAuth 2.0) |
| Skin viewer | [skinview3d](https://github.com/bs-community/skinview3d) 3.x (three.js), loaded only with the skin manager |

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) package manager
- A [Microsoft Azure](https://portal.azure.com/) registered application (for OAuth)
- A [Firebase](https://firebase.google.com/) project with Firestore enabled

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/diaohh/NoName-Launcher.git
   cd NoName-Launcher
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in your values:

   ```bash
   cp .env.example .env
   ```

   | Variable | Description |
   |----------|-------------|
   | `MICROSOFT_CLIENT_ID` | Azure AD application client ID |
   | `VITE_FIREBASE_API_KEY` | Firebase API key |
   | `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
   | `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

   > Every variable is read **at build time**; `.env` is never shipped and never read by the running app. `VITE_` variables are inlined into the renderer bundle, and `MICROSOFT_CLIENT_ID` is inlined into the main bundle by `electron.vite.config.mjs` — `pnpm dev` and `pnpm build` both stop with an error if it is missing or is not an Azure application id. A variable set in the environment wins over `.env`.

   The Azure application must be a **public client** with the redirect URI `https://login.microsoftonline.com/common/oauth2/nativeclient` and the `XboxLive.signin offline_access` scopes.

4. **Set up Firestore**

   ```
   modpacks/{id} — Modpack definitions
   ```

   Firestore holds only the catalogue and a pointer. The files themselves, the mod loader
   and the per-path policies live in a manifest published to the CDN — see
   [docs/manifest.md](docs/manifest.md).

   **Modpack document**

   | Field | Type | Description |
   |-------|------|-------------|
   | `name` | string | Display name |
   | `description` | string | Shown under the title on the home screen |
   | `minecraftVersion` | string | **Display only.** The manifest is authoritative for launching |
   | `icon` | string (URL) | Sidebar icon |
   | `banner` | string (URL) | Full-window background. **Art only, no text**: it is centred on the window and cropped, so a title drawn into it never lines up with the play button |
   | `logo` | string (URL) | Optional transparent title image, centred on the play button's axis and scaled to the space the window leaves |
   | `accentColor` | string | Optional `#rgb` / `#rrggbb` for the play button and the progress bar; anything else falls back to the launcher's orange |
   | `isPublic` | boolean | Must be `true` to be queryable |
   | `enabled` | boolean | Toggle modpack visibility |
   | `usersAllowed` | string[] | Minecraft **usernames** allowed to see the modpack |
   | `order` | number | Display order in the sidebar |
   | `java.minRam` / `java.maxRam` | string | Optional, e.g. `4G` — overrides launcher defaults |
   | `maintenance` | boolean | Blocks launching while a modpack update is being uploaded |
   | `maintenanceMessage` | string | Optional text shown to the player instead of launching |
   | `manifest.url` | string | `https://<cdn>/<packId>/manifest.json` |
   | `manifest.hash` | string | sha256 of that file; the launcher refuses a mismatch |
   | `manifest.version` | string | Pack version, informational |

   Players only pick up a new manifest once `manifest.hash` is flipped. The files themselves,
   however, are overwritten in place on the CDN during the upload, so **publishing is only
   safe while `maintenance` is `true`, and rolling back means re-uploading the old version** —
   pointing the hash back is not enough. See "Publishing and rollback" in
   [docs/manifest.md](docs/manifest.md) and the proposed fix in
   [ADR-0012](docs/adr/0012-content-addressed-pack-files.md).

   > **`usersAllowed` is not access control.** It is filtered client-side, so anyone with
   > the bundle can read the whole catalogue. Enforcing it in Security Rules is not
   > possible as things stand: the launcher does not authenticate against Firebase, so
   > `request.auth` is always `null` and there is no identity to match a username
   > against. Closing this needs either a Cloud Function that mints a custom token from
   > a verified Minecraft profile, or a data model where private packs are simply not
   > publicly readable. See the stand-by entry in `TODO.md`.

## How a Launch Works

```
Validate account (refresh Microsoft/Minecraft tokens if needed)
  → Re-read the modpack document (maintenance flag, current manifest pointer)
  → Fetch the manifest and verify it against the hash in Firestore
  → Sync the instance: download what is missing or changed, delete orphans in `strict` paths
  → Download the vanilla client, libraries and assets (helios-core)
  → Resolve the required Java version from the version manifest, then reuse or download a JVM
  → Install the mod loader (Fabric Meta profile / Forge installer)
  → Download loader libraries
  → Build the launch command and spawn the game (detached: it keeps running if the launcher closes)
  → Follow the game output to its title screen (the last step of the progress bar)
```

Everything runs in the main process and reports progress to the renderer over a single `launch:progress` event. Only one launch runs at a time — the main process refuses a second one rather than relying on the button being disabled.

The launcher is **online-only**. Every launch validates or refreshes a Minecraft token against
Microsoft, so there is no offline mode and no cached catalogue: a modpack list that cannot be
read is reported with a retry instead of being faked from disk. See
[ADR-0009](docs/adr/0009-no-offline-mode.md).

## Data Directories

The launcher root is `%APPDATA%/.nonamelauncher` on Windows (`~/Library/Application Support/.nonamelauncher` on macOS, `~/.local/share/.nonamelauncher` on Linux):

```
config.json          Launcher settings + account database
logs/                launcher.log, rotated at 5 MB, five files kept (Settings → "Abrir carpeta de logs")
running-game.json    The game started by the launcher, while it runs (stops a second one starting on top)
skins/               The skin vault: one <sha256>.png per skin plus index.json, shared by every account
```

Everything bulky lives under the **data directory**, which defaults to that same root and can be moved from Settings → Launcher:

```
common/              Shared data: assets, libraries, versions, forge, fabric
runtime/             JVMs downloaded by the launcher
manifests/           Verified pack manifests, keyed by sha256
instances/<id>/      Per-modpack game directory (mods, config, saves, natives)
```

`config.json`, `logs/` and `skins/` always stay in the launcher root — the config is what records where the data directory is, and the logs have to be findable even when the data directory is what broke. Changing the setting affects new downloads only; existing files are not moved.

Only one launcher runs at a time: opening it again brings the existing window to the front.

## Development

```bash
pnpm dev        # electron-vite dev server, hot reload for the renderer
pnpm lint       # ESLint (flat config) — the repo stays at 0 errors
pnpm test       # Vitest (pnpm test:watch to keep it running)
pnpm typecheck  # tsc --noEmit over the main/preload and renderer projects
```

### Contributing

Before opening a pull request, `pnpm lint` and `pnpm typecheck` must report 0 errors,
`pnpm test` must pass and `pnpm build` must compile. electron-vite strips TypeScript types
without checking them, so `pnpm typecheck` is the only thing that does.

- **The code is moving to TypeScript** ([ADR-0015](docs/adr/0015-incremental-typescript-migration.md)).
  New files are `.ts`/`.tsx` with `strict` on; existing JavaScript is converted file by file
  and is not type-checked until then. The main process, the preload and `src/shared` are
  already TypeScript; the renderer is next.
- **Tests sit next to the file they cover** (`ConfigManager.test.ts` beside `ConfigManager.ts`)
  and run on node through Vitest, with `electron` replaced by a stub
  (`src/main/testing/electron.ts`). Coverage is deliberately small: a test is worth adding when
  the behaviour would otherwise fail without anyone noticing.
- **Indentation depends on the area** — 4 spaces in `src/main/managers`, `utils`, `windows`,
  `testing` and `types`, 2 everywhere else, `.ts` included. ESLint enforces it
  ([ADR-0011](docs/adr/0011-enforce-indentation-per-area.md)).

Design decisions and the reasoning behind the conventions below live in
[docs/adr/](docs/adr/README.md). Coding agents read [AGENTS.md](AGENTS.md), which states the
same rules in the form they need while editing.

Two conventions are easy to break from outside and are worth reading before a first change:

- **Every IPC call is declared in `src/shared/ipcContract.ts`** — the name in
  `src/shared/channels.ts`, what it takes and returns in the contract, then the handler in its
  `*.ipc.ts` map, the method in `src/preload/index.ts` and the wrapper in
  `src/renderer/src/services/ipcClient.ts`. Each layer is typed against the contract, so one
  that misses the channel does not compile. Handlers get their arguments as `unknown` and
  validate them: the renderer is not trusted.
- **Errors cross the IPC boundary in a `{ ok, code, message }` envelope**, never as a thrown
  `Error`. Handlers are registered from one map through `handleAll()` in
  `src/main/ipc/result.ts`; main throws `LauncherError` with a code from
  `src/shared/errorCodes.ts`. Never branch on message text.

### Gotchas

- **`helios-distribution-types` looks unused. It is not — do not remove it.** Nothing in
  `src/` imports it, so every dependency audit flags it. It is required at runtime by
  `helios-core/common` (→ `DistributionAPI` → `DistributionFactory`), which is where
  `AuthManager` gets `RestResponseStatus`, and helios-core declares it only as a
  **devDependency** — so the consumer has to provide it. Removing it once left the launcher
  unable to start from a clean install, and it stayed hidden for weeks because the existing
  `node_modules` still had the package on disk. It will only reproduce after
  `rm -rf node_modules && pnpm install`.
- **The Electron binary is downloaded on first use, not on install.** Since Electron 42 the
  package has no postinstall script; `pnpm dev` and `pnpm preview` run `install-electron`
  first, because electron-vite expects the binary to be there already. The first `pnpm dev`
  after a clean install takes a little longer while it downloads.
- **`resources/` is electron-vite's public directory for the main process.** The window icon
  is imported as `resources/icon.png?asset&asarUnpack`, which resolves to a path next to the
  bundle rather than copying the file, so `electron-builder.yml` has to ship it explicitly
  (`files` + `asarUnpack`). The same file is the installer/executable icon.
- **Logs go through `src/main/utils/Logger.ts`**, one winston logger with a console and a
  rotating file transport. Error objects are written as stack, code and cause chain, and
  anything that looks like a token is redacted — but that is a safety net: never log a token,
  or an object that may carry one. helios-core's own internal loggers still write to the
  console only.
- **The development behaviour only exists unpackaged.** The dev renderer URL, DevTools and the
  relaxed CSP are gated on `app.isPackaged`, so no environment variable can switch an installed
  launcher into them.

Known gaps and their priority are tracked in [TODO.md](TODO.md).

## Build & Package

```bash
pnpm build              # Build for production
pnpm package            # Windows NSIS installer + portable executable
pnpm package:linux      # Linux AppImage
pnpm package:mac        # macOS DMG
```

Packaged output goes to `dist/`. The application icon is `resources/icon.png` (1024×1024, transparent), used both for the executables and for the window.

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.js            # BrowserWindow setup
│   ├── managers/           # Business logic (static classes)
│   │   ├── AuthManager     # Microsoft OAuth + Minecraft auth
│   │   ├── ConfigManager   # Local config persistence
│   │   ├── DistributionManager  # Modpack data + file validation/download
│   │   ├── LaunchManager   # Java, launch command, game process
│   │   ├── ModLoaderManager     # Forge / Fabric installation
│   │   ├── MinecraftDownloadManager  # Vanilla assets via helios-core
│   │   └── SkinManager     # Mojang profile (skin, capes) + local skin vault
│   ├── utils/              # Logger, file hashing
│   └── ipc/                # IPC channel handlers
├── preload/                # Context bridge (main ↔ renderer)
│   └── index.js
├── shared/                 # Bundled into more than one process — must stay dependency-free
│   ├── channels.js         # IPC channel names, read by the handlers and the preload
│   ├── errorCodes.js       # The only source of IPC error codes
│   └── skins.js            # Skin name limit and models, checked on both sides
└── renderer/src/           # React application
    ├── App.jsx             # Root component + providers
    ├── contexts/           # Auth, Launch, Servers, Status
    ├── services/           # ipcClient, Firebase, Firestore queries, launchPhases
    ├── hooks/              # useServers
    └── components/
        ├── auth/           # Login screen
        ├── common/         # Modal (portal + Escape), status message
        ├── home/           # Main screen (sidebar, background, profile)
        ├── launch/         # Play button, kill button, progress bar, log viewer
        ├── settings/       # Settings screen
        └── skins/          # Skin manager (lazy-loaded: 3D viewer, vault, capes)
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run `pnpm lint` — the repo stays at 0 errors
4. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/) in English, one logical change per commit
5. Push to the branch (`git push origin feature/my-feature`)
6. Open a Pull Request

A change that alters a structural decision needs an ADR in [docs/adr/](docs/adr/README.md) in the same PR.

## License

[MIT](LICENSE)
