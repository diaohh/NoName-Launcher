# 0009. No offline mode: report the network failure instead

- **Status**: Accepted
- **Date**: 2026-09-01
- **Commit**: `1e7a5e6`

## Context

"Modo offline" sat in `TODO.md` P4 as *"sin red no se cargan los modpacks, ni siquiera para
ver la lista"*, next to a separate entry for Firestore errors being swallowed. Read together
they suggest the launcher should keep working without a connection, and that the missing
piece is a cache of the catalogue.

It is not. Launching needs a valid Minecraft access token, and that token comes from the
Microsoft → XBL → XSTS → Minecraft chain in `AuthManager`, every step of which is a network
call. The token also expires in about a day, so even a session that was validated an hour ago
does not survive long. There is no code path in this launcher that spawns the game without
having talked to Microsoft first.

A cached catalogue would therefore show the player a list of modpacks that none of them can
be launched. That is a worse failure than an empty screen: it looks like it works.

The two P4 entries also turned out to be one problem. `useServers` already caught the error
and stored it in state; nothing rendered it, so the sidebar fell through to "Sin servidores"
— indistinguishable from "you have no modpacks assigned", which is the one conclusion a
player must not draw when the real cause is their Wi-Fi.

## Decision

The launcher is **online-only**, and says so by failing clearly rather than by degrading.

A catalogue read that fails is surfaced as an explicit error state with a **"Reintentar"**
button (`components/home/ServersError.jsx`), and the sidebar shows "Sin conexion" instead of
"Sin servidores". No modpack list is cached for offline display, and no offline or cracked
account type is introduced.

Because the full Firebase SDK does not reject when the device is offline — it queues the read
and retries indefinitely — every Firestore read is raced against a 12 s timeout in
`firestoreService`. Without it the honest symptom of "no network" is an infinite
"Cargando...", which is the same lie by a different route.

## Consequences

- No connection means no play, and the UI states it plainly and offers a retry.
- The timeout cannot cancel the request underneath, only stop waiting for it. A read that
  eventually succeeds after the timeout is discarded.
- The 12 s figure is a judgement call: long enough for a slow mobile tether, short enough
  that nobody assumes the launcher hung. Moving to `firebase/firestore/lite` (P5) would make
  the race unnecessary, since a plain REST call fails on its own.
- Anything added later that reads from the network — pack details, news, a changelog — has to
  carry its own error state. There is no global "you are offline" banner, deliberately: a
  failure is reported by whatever needed the network, where the player was looking.
- Reopening this decision means one of the alternatives below, not a cache.

## Alternatives considered

- **Cache the modpack list and show it offline.** Cheap, and useless: the play button cannot
  work, so the list is decoration. It converts a clear failure into a confusing one.
- **Offline / cracked accounts, launching with a synthetic UUID.** This is what launchers with
  a real offline mode do. It is out of scope for a launcher whose whole distribution model is
  built around a Microsoft identity, and it would make `usersAllowed`
  ([0006](0006-usersallowed-is-ux-not-access-control.md)) meaningless on top of already being
  UX-only.
- **Retry silently in the background instead of asking the player.** *(reconstructed)* Hides
  the state the player needs in order to act — the fix is usually theirs to make, and a spinner
  does not tell them that.
- **A global offline banner over the whole app.** *(reconstructed)* `navigator.onLine` reports
  the adapter, not reachability, and a launcher behind a captive portal is "online". The
  failure is reported where it actually happened instead.
