# 0014. Change skins through the main process and hand textures over as data URLs

- **Status**: Accepted
- **Date**: 2026-11-06
- **Commit**: not committed yet

## Context

The launcher gained a skin manager ("Gestor de Skins"): a 3D viewer, a local vault of skins the
player imported, the account's capes, and a "Guardar" that changes the skin and the cape on
Mojang. Every Mojang call it needs (`GET /minecraft/profile`, `POST /minecraft/profile/skins`,
`PUT`/`DELETE /minecraft/profile/capes/active`) is authenticated with the Minecraft access
token, and that token never reaches the renderer (ADR-0007).

Three more constraints shaped it:

- The renderer cannot read files and should not be handed paths (`logs:export` set the
  precedent: the path comes from the native dialog in main).
- The CSP (ADR-0010) only lets the renderer `connect-src` to Firestore. Textures live on
  `textures.minecraft.net`, which the profile still lists as `http://` URLs.
- The avatar came from minotar.net, a third party that caches renders server-side. After a skin
  change it kept showing the old head for a while, and nothing on the launcher's side could
  invalidate it.

## Decision

- **Every Mojang call happens in main**, in `SkinManager`, after
  `AuthManager.validateSelectedMicrosoftAccount()` has renewed the token if needed. A failure
  of that check keeps its `AUTH_*` code, so the renderer logs out on a terminal one exactly as
  it does for a launch.
- **Textures cross to the renderer as `data:` URLs**, whether they came from Mojang or from the
  vault. The renderer never contacts a new origin and the CSP stays as it is. Texture URLs from
  a profile are only followed when they point at `textures.minecraft.net`, and over https.
- **The vault is one folder for every account**, `<launcherDir>/skins/`: `<sha256>.png` per
  skin plus `index.json` (name, model, the Mojang texture URL it was last published under). It
  sits next to `config.json`, not under the movable data directory (ADR-0004), because it holds
  the player's own files, not a cache. The skin the account is wearing is added to it every time
  the profile is read, so changing skins can never lose the current one.
- **Importing, renaming and deleting are immediate**, like a file explorer; only the skin, its
  model and the cape wait for "Guardar", and only what differs from the profile is sent.
  Deleting moves the file to the system trash and is refused for the skin being worn.
- **The 3D viewer is `skinview3d`** (on three.js), loaded with `React.lazy` so it is a chunk of
  its own that the launcher only reads when the screen opens. The vault's thumbnails are flat
  front views on a 2D canvas: one WebGL context per card would hit Chromium's limit.
- **The avatar is drawn from the skin texture** (face and hat layer, in CSS), and minotar is
  gone.

## Consequences

- No new origin in the CSP, no token in the renderer, and no path from the renderer.
- Mojang re-encodes an uploaded image, so the texture it serves is not the file that was sent.
  The vault therefore matches the worn skin by its **texture URL first** and by the hash of the
  downloaded texture second; after an upload the entry that was sent claims the new URL. A URL
  belongs to one entry at most.
- A PNG is validated by its header only (signature, IHDR, 64x64 or 64x32), in main, on import
  and again before upload. Mojang has the last word on anything else; a 400 is reported as a
  rejected skin.
- The startup makes one extra profile request, for the avatar. Offline it fails quietly and the
  avatar shows the name's initial; a terminal auth failure logs the player out.
- The renderer chunk for the skin manager is ~900 KB minified (~165 KB gzipped), almost all
  three.js. The initial bundle does not grow: `skinview-utils` is imported only from that chunk,
  which is why `SkinHead` carries its own CSS instead of importing `services/skinTextures`.
- A skin restored from the trash, or every skin after `index.json` was lost, is adopted back on
  the next read of the vault (as "Skin", model unknown).
- Mojang rate-limits skin changes. A 429 is `SKIN_RATE_LIMITED`, never retried on its own.

## Alternatives considered

- **Load textures straight from `textures.minecraft.net` in the renderer.** It sends
  `Access-Control-Allow-Origin: *` (checked on 2026-11-06), so WebGL could use them, and
  `img-src https:` already allows them. Lost because vault skins come from disk anyway, so the
  renderer would have needed two paths, and the profile's `http://` URLs would have had to be
  rewritten in the renderer too.
- **React Query (or axios) for the requests.** Neither solves the stale avatar, whose cache was
  on minotar's server. axios would be a third HTTP client next to `fetch` and helios' `got`, and
  the renderer only talks IPC. React Query's caching and deduplication have few customers here;
  worth its own ADR if the launcher grows several accounts or live server status.
- **A vault per account, as a subfolder per uuid.** Only one account is signed in at a time, and
  a player with two accounts would have had to import the same skins twice.
- **Store the cape with each skin, as Prism Launcher does.** Mojang keeps them independent, and
  tying them made "Guardar" change a cape the player never touched.
