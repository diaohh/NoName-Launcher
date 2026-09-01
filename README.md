# NoNameLauncher

A custom Minecraft launcher built with Electron, React, and Tailwind CSS. Features Microsoft authentication, Firestore-based modpack distribution with per-user access control, and automatic Java management.

<!-- ![NoNameLauncher Screenshot](docs/screenshot.png) -->

## Features

- **Microsoft Authentication** — Full OAuth flow with automatic token refresh
- **Modpack Distribution** — Managed via Firebase Firestore with per-user allow lists
- **Automatic Java Management** — Reads the required Java version from the Minecraft manifest, reuses a compatible JVM if one is installed, downloads it otherwise
- **Fabric Support** — Loader profile resolved from the Fabric Meta API. Forge is implemented but not yet reachable end to end (see the loader table below)
- **Per-Modpack Settings** — RAM allocation defined per modpack, used by default; a launcher-wide slider takes over when the per-modpack override is switched off in Settings
- **Dynamic UI** — Modpack banners, player skin display via Minotar, glassmorphism dark theme
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
| Framework | Electron 37 |
| Frontend | React 19, Tailwind CSS v4 |
| Build | electron-vite, electron-builder |
| Backend | Firebase Firestore |
| Game Engine | [helios-core](https://github.com/dscalzi/helios-core) 2.x — signatures changed in 2.x, check `node_modules/helios-core/dist/**/*.d.ts` |
| Auth | Microsoft Azure AD (OAuth 2.0) |

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

   > Variables prefixed with `VITE_` are inlined into the renderer bundle at build time. Non-prefixed variables are read by the main process at runtime — and `.env` is **not** shipped inside the packaged app, so anything the main process needs in production must have a build-time default.

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
   | `icon` / `banner` | string (URL) | Sidebar icon and background image |
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

   `manifest.hash` is the only field that changes when a modpack is updated, which makes
   publishing atomic: nothing is visible to players until it is flipped.

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
  → Build the launch command and spawn the game
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
```

Everything bulky lives under the **data directory**, which defaults to that same root and can be moved from Settings → Launcher:

```
common/              Shared data: assets, libraries, versions, forge, fabric
runtime/             JVMs downloaded by the launcher
manifests/           Verified pack manifests, keyed by sha256
instances/<id>/      Per-modpack game directory (mods, config, saves, natives)
```

`config.json` always stays in the launcher root — it is what records where the data directory is. Changing the setting affects new downloads only; existing files are not moved.

## Development

```bash
pnpm dev     # electron-vite dev server, hot reload for the renderer
pnpm lint    # ESLint (flat config) — the repo stays at 0 errors
```

Design decisions and the reasoning behind the conventions below live in
[docs/adr/](docs/adr/README.md).

Two conventions are easy to break from outside and are worth reading before a first change:

- **Adding an IPC call means touching four layers** — `src/main/ipc/channels.js`, the
  `*.ipc.js` handler, `src/preload/index.js`, and `src/renderer/src/services/ipcClient.js`.
  A channel missing from any of them is dead code.
- **Errors cross the IPC boundary in a `{ ok, code, message }` envelope**, never as a thrown
  `Error`. Handlers register through `handle()` from `src/main/ipc/result.js`; codes are
  shared constants in `src/shared/errorCodes.js`. Never branch on message text.

## Build & Package

```bash
pnpm build              # Build for production
pnpm package            # Windows NSIS installer + portable executable
pnpm package:linux      # Linux AppImage
pnpm package:mac        # macOS DMG
```

Packaged output goes to `dist/`. Packaging requires `resources/icon.png` to exist — it is referenced by `electron-builder.yml` and by the main process window.

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
│   │   └── MinecraftDownloadManager  # Vanilla assets via helios-core
│   ├── utils/              # Logger, file hashing
│   └── ipc/                # IPC channel handlers
├── preload/                # Context bridge (main ↔ renderer)
│   └── index.js
├── shared/                 # Bundled into BOTH processes — must stay dependency-free
│   └── errorCodes.js       # The only source of IPC error codes
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
        └── settings/       # Settings screen
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
