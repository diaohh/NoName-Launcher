# NoNameLauncher

A custom Minecraft launcher built with Electron, React, and Tailwind CSS. Features Microsoft authentication, Firestore-based modpack distribution with per-user access control, and automatic Java management.

<!-- ![NoNameLauncher Screenshot](docs/screenshot.png) -->

## Features

- **Microsoft Authentication** — Full OAuth flow with automatic token refresh
- **Modpack Distribution** — Managed via Firebase Firestore with per-user allow lists
- **Automatic Java Management** — Reads the required Java version from the Minecraft manifest, reuses a compatible JVM if one is installed, downloads it otherwise
- **Forge & Fabric Support** — Forge is installed with the official installer, Fabric through the Fabric Meta API
- **Per-Modpack Settings** — RAM allocation defined per modpack, overriding launcher defaults
- **Dynamic UI** — Modpack banners, player skin display via Minotar, glassmorphism dark theme
- **Cross-Platform** — Windows (NSIS installer + portable), Linux (AppImage), macOS (DMG)

## Supported Minecraft Versions

**Minecraft 1.17 and newer.** Older releases use a different manifest format (`minecraftArguments`) and ship natives as library classifiers that must be extracted manually; that path is intentionally not implemented. Selecting a modpack below 1.17 fails with an explicit error instead of launching a broken game.

| Loader | Status |
|--------|--------|
| Vanilla | Supported |
| Forge (1.17+) | Supported — installed via the official Forge installer |
| Fabric (1.17+) | Supported — profile resolved from `meta.fabricmc.net` |
| Minecraft ≤ 1.16 | Not supported |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 37 |
| Frontend | React 19, Tailwind CSS v4 |
| Build | electron-vite, electron-builder |
| Backend | Firebase Firestore |
| Game Engine | [helios-core](https://github.com/dscalzi/helios-core) 2.3 |
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

   > `usersAllowed` is filtered client-side for convenience. Real access control must be enforced with Firestore Security Rules.

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

Everything runs in the main process and reports progress to the renderer over a single `launch:progress` event.

## Data Directories

Everything lives under `%APPDATA%/.nonamelauncher` on Windows (`~/Library/Application Support/.nonamelauncher` on macOS, `~/.local/share/.nonamelauncher` on Linux):

```
config.json          Launcher settings + account database
common/              Shared data: assets, libraries, versions, forge, fabric
common/runtime/      JVMs downloaded by the launcher
instances/<id>/      Per-modpack game directory (mods, config, saves, natives)
```

## Development

```bash
pnpm dev
```

This starts the electron-vite dev server with hot reload for the renderer process.

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
└── renderer/src/           # React application
    ├── App.jsx             # Root component + providers
    ├── contexts/           # AuthContext, LaunchContext, ServersContext
    ├── services/           # ipcClient, Firebase, Firestore queries
    ├── hooks/              # useServers
    └── components/
        ├── auth/           # Login screen
        ├── home/           # Main screen (sidebar, background, profile)
        ├── launch/         # Play button, progress bar, log viewer
        └── settings/       # Settings screen
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
