# 0002. Carry IPC errors in a result envelope with shared codes

- **Status**: Accepted
- **Date**: 2026-08-29
- **Commit**: `f1688fd`

## Context

Electron does not send an `Error` across the IPC boundary — it serializes it to a string.
`error.code` disappears and the message reaches the renderer as
`Error invoking remote method 'launch:game': Error: Session expired`.

The renderer coped by matching on message text. `PlayButton` decided whether to log the
player out by testing whether the message contained a substring, which meant a network
blip could look exactly like a dead session. Error objects sent as plain values had the
same problem in reverse: `microsoftErrorDisplayable` returned `{title, desc}`, and `desc`
silently vanished on the way over, which is how users ended up reading "undefined".

## Decision

- Every channel is registered through `handle()` from `src/main/ipc/result.js`, which answers
  `{ ok: true, data }` or `{ ok: false, code, message }`. **Do not call `ipcMain.handle`
  directly** — two contracts coexisting is the failure this replaces.
- `ipcClient.js` unwraps the envelope and rebuilds a real `Error` carrying `.code`, so
  existing `try/catch` in the renderer keeps working unchanged.
- Codes live in `src/shared/errorCodes.js`, imported by **both** processes. Never compare
  against a literal copied into the renderer, and never branch on message text.
- Anything in `src/shared/` is bundled into both bundles and must stay dependency-free.

## Consequences

- The renderer branches on codes (`isTerminalAuthCode(err.code)`), so a transient failure can
  no longer be mistaken for a terminal one — which is the same invariant [0007](0007-encrypt-account-secrets-with-safestorage.md)
  and the auth error classification depend on.
- The `Error invoking remote method '...'` prefix is gone from every channel, so user-facing
  messages can be written in Spanish and shown verbatim.
- Adding a channel means touching four layers — `channels.js`, the `*.ipc.js` handler, the
  preload bridge, `ipcClient.js`. A channel missing from any of them is dead code, and two
  such channels (`config:load`, `config:save`) were found and deleted exactly this way.
- The four-layer rule is enforced by review today. Typing it is the main return on the
  TypeScript migration listed in P5.

## Alternatives considered

- **Throw and parse the message on the other side.** What existed. It is why substring
  matching appeared, and it cannot carry a code.
- **`ipcRenderer.invoke` returning `null` on failure.** *(reconstructed)* Loses the reason entirely; the UI
  then cannot tell "no account" from "the disk is unreadable".
- **A custom serializer for `Error`.** *(reconstructed)* More machinery than the envelope for the same result,
  and still leaves each handler free to invent its own shape.
