# NoNameLauncher

A custom Minecraft launcher built with Electron, React, and Tailwind CSS. Features Microsoft authentication, Firestore-based modpack distribution with per-user access control, and automatic Java management.

<!-- ![NoNameLauncher Screenshot](docs/screenshot.png) -->

## Features

- **Microsoft Authentication** — Full OAuth flow with automatic token refresh
- **Modpack Distribution** — Managed via Firebase Firestore with per-user allow lists
- **Automatic Java Management** — Detects or downloads the correct Java version per Minecraft release
- **Forge/ModLoader Support** — Automatic installation of Forge and other mod loaders
- **Dynamic UI** — Modpack banners, player skin display via Minotar, glassmorphism dark theme
- **Cross-Platform** — Windows (NSIS installer), Linux (AppImage), macOS (DMG)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 37 |
| Frontend | React 19, Tailwind CSS v4 |
| Build | electron-vite, electron-builder |
| Backend | Firebase Firestore |
| Game Engine | [helios-core](https://github.com/dommilosz/helios-core) |
| Auth | Microsoft Azure AD (OAuth 2.0) |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
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
   | `LAUNCHER_NAME` | Display name for the launcher |
   | `LAUNCHER_VERSION` | Launcher version string |
   | `DISTRIBUTION_URL` | URL to distribution.json (legacy, optional) |
   | `VITE_FIREBASE_API_KEY` | Firebase API key |
   | `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
   | `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |

   > Variables prefixed with `VITE_` are exposed to the renderer process. Non-prefixed variables are only available in the main process.

4. **Set up Firestore**

   Create the following collections in your Firebase project:

   ```
   config/launcher          — Launcher global config
   modpacks/{id}            — Modpack definitions (name, banner, icon, version, etc.)
   modpacks/{id}/modules/{id} — Module artifacts (Forge, mods, configs)
   ```

   Each modpack document supports:
   - `isPublic: boolean` — Must be `true` to be queryable
   - `enabled: boolean` — Toggle modpack visibility
   - `usersAllowed: string[]` — Minecraft **usernames** allowed to see the modpack
   - `order: number` — Display order in the sidebar

## Development

```bash
pnpm dev
```

This starts the electron-vite dev server with hot reload for the renderer process.

## Build & Package

```bash
pnpm build              # Build for production
pnpm package            # Windows NSIS installer
pnpm package:linux      # Linux AppImage
pnpm package:mac        # macOS DMG
```

Packaged installers are output to the `dist/` directory.

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.js            # BrowserWindow setup
│   ├── managers/           # Business logic (static classes)
│   │   ├── AuthManager     # Microsoft OAuth + Minecraft auth
│   │   ├── ConfigManager   # Local config persistence
│   │   ├── LaunchManager   # Java detection, game launch
│   │   └── ...
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
3. Commit your changes
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
