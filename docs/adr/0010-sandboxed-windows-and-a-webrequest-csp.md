# 0010. Sandbox both windows and apply the CSP through `webRequest`

- **Status**: Accepted
- **Date**: 2026-08-27
- **Commit**: `25256d4`, `6ab486b`, merged in `28e0506`

## Context

The launcher opens two windows that render remote-influenced content. The main window shows
modpack banners, icons and descriptions that come from Firestore and are written by whoever
publishes a pack. The sign-in window loads Microsoft's own pages.

Both had `nodeIntegration: false` and `contextIsolation: true` from the start, but neither had
a Content Security Policy, neither restricted where it could navigate, and the sign-in window
could be steered anywhere by a link on a Microsoft page.

The obvious way to add a CSP — a `<meta http-equiv="Content-Security-Policy">` in
`index.html` — does not work here. The *same* `index.html` is served by the vite dev server
during `pnpm dev`, and vite's hot reload needs `ws:` and `'unsafe-eval'`. A static tag would
have to be loose enough for dev, and that looseness would ship.

## Decision

**The renderer is sandboxed and the policy is a response header, not a tag.**

- Both `BrowserWindow`s run with `sandbox: true`. The preload therefore **must stay CJS** — a
  sandboxed preload has no ESM loader — and may use nothing but `contextBridge` and
  `ipcRenderer`.
- The CSP is attached in `session.defaultSession.webRequest.onHeadersReceived`
  (`src/main/index.js`), which lets the dev and production policies differ from one source:
  dev gets `'unsafe-eval'` and `ws:`, production gets `script-src 'self'`.
- The header is attached **only to the launcher's own document** (`file://`, or the dev server
  URL). Microsoft's pages ship their own policy and overwriting it breaks sign-in.
- Navigation is allowlisted per window. The main window may not leave its own document and
  opens `https://` links in the system browser instead; the sign-in window is restricted to a
  set of Microsoft hosts, wide enough to include sign-up and password reset — otherwise the
  window is a dead end for anyone who cannot get past the password box.
- Popups are denied in both (`setWindowOpenHandler` → `{ action: 'deny' }`).

## Consequences

- **The full ESM migration is blocked by this**, not by effort. The preload cannot become ESM
  while the window is sandboxed, so `"type": "module"` means the main process moves to `.mjs`
  and loses `__dirname` while the preload stays CJS. That is why the migration sits in P5 and
  why the postcss warning was closed by renaming a config file instead.
- Verified on 2026-09-01 that **`onHeadersReceived` does intercept `file://`**: in a production
  run the `index.html`, its JS, its CSS and the woff2 files all pass through it and are
  recognised as the launcher document. The policy therefore covers production as well as dev,
  and `'self'` matches local assets. The Electron security warning about `unsafe-eval` seen in
  `pnpm dev` is only the dev branch of the policy and disappears once packaged.
- Anything the renderer needs from a new origin has to be added to the policy deliberately.
  This has already bitten once: a Google Fonts `@import` in `App.css` was blocked by
  `style-src` and no custom font ever rendered. The fix was to self-host the font, not to widen
  the policy.
- The sign-in window may not be closed from inside a navigation event: `did-redirect-navigation`
  fires while the redirect is still in flight and destroying the `webContents` there crashes
  the process with an access violation. The close is deferred a tick (`setImmediate`).
- Both `did-navigate` and `did-redirect-navigation` must be listened to. Listening to one left
  the window hanging on some flows.

## Alternatives considered

- **`<meta http-equiv>` in `index.html`.** The reason this was rejected is the whole point of
  the decision: one document serves both dev and production, so a tag forces the dev
  requirements into the shipped policy.
- **Leave the main window unsandboxed** so the preload can be ESM and the migration is simpler.
  The renderer displays strings and image URLs written by pack publishers; that is exactly the
  content a sandbox exists for. The migration is worth less than the isolation.
- **A separate `session` for the sign-in window** so its headers are untouched without a URL
  check. *(reconstructed)* A second partition would also split cookies, which is a behaviour
  change to the sign-in flow for no gain over the URL check already in place.
- **`webSecurity: false` during development** to sidestep the dev/production split.
  *(reconstructed)* Turns dev into a materially different environment from production, which is
  how CSP problems reach users.
