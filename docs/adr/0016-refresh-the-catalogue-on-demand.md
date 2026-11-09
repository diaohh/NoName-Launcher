# 0016. Refresh the modpack catalogue on demand, without a server-state library

- **Status**: Accepted
- **Date**: 2026-11-09
- **Commit**: (pending)

## Context

`useServers` reads the catalogue (`modpacks/*` in Firestore) once, when the home screen
mounts, and again only on "Reintentar". A modpack published while the launcher stays open does
not show up until it is restarted. What must be current to launch already is: `prepareLaunch`
re-reads the modpack document when JUGAR is pressed, so a `maintenance` flag or a withdrawn
modpack is caught there whatever the list says.

The `TODO.md` item proposed re-reading the list when the window regains focus. Three ways of
doing that were weighed with the user on 2026-11-09:

- A `focus` listener in `useServers`. The first attempt also reworked the load effect (shared
  read counter, refs) to keep two concurrent reads apart, which is the kind of effect
  [ADR-0008](0008-useeffect-only-for-external-systems.md) exists to keep out.
- TanStack Query, which ships `refetchOnWindowFocus` with a `staleTime` and would replace
  `useIpcResource` too.
- A refresh button the player presses.

What decided it is the read budget. The launcher uses `firebase/firestore/lite`, which has no
local cache: every `getDocs` goes to the server, and each document returned is one billed read.
The Spark plan allows 50,000 a day. Roughly:

```
reads/day ≈ players × (opens × N + refreshes × N + launches)        N = modpacks in the catalogue
```

With N = 10 and 50 players opening the launcher 3 times and playing 3 times a day, today's
cost is ~1,650 reads. A focus refresh bounded by a 15-minute `staleTime` brings it to ~4,650;
one without a bound (every alt-tab) goes past the daily quota. Focus is an event the player
triggers dozens of times without meaning "show me new modpacks", and the catalogue changes a
few times a month, published by the team itself.

## Decision

- The catalogue is read on mount, on "Reintentar" and on the **refresh button** at the foot of
  the sidebar (`useServers.refresh`), and at no other time. Nothing reads it in the background.
- The refresh runs in the click handler, not in an effect. It keeps the list on screen while
  it reads, reports a failure as a toast (`showStatus`) instead of the error panel, and rests
  for `REFRESH_COOLDOWN_MS` (30 s) after a read that went through, so repeated clicks cost at
  most N reads every 30 s per player. It is disabled while a launch is being prepared.
- After a refresh, the selection is replaced by its fresh copy, or cleared when the catalogue
  no longer lists it — except while the game is running, which keeps its modpack on screen.
- No server-state library (TanStack Query, SWR). `useIpcResource` stays the one way to read
  over IPC on mount.

## Consequences

- Reads stay where they are today, plus whatever the player asks for. Any new automatic read of
  the catalogue has to be justified against the formula above, in this file.
- A new modpack appears when the player presses the button or reopens the launcher. That is the
  accepted cost.
- The button is not protection against abuse. The API key is in the bundle and the rules let
  anyone read the catalogue, so a script can still exhaust the Spark quota and leave the
  catalogue failing for every player until the daily reset. That is tracked in `TODO.md`
  ("Pendientes de decision") with the `usersAllowed` item, which shares its cause.

## Alternatives considered

- **Refresh on window focus, bounded by a `staleTime`.** Cheap enough at 15 minutes, but it
  needs a `window` subscription in `useServers`, and it spends reads on an event that does not
  mean the player wants a new list.
- **TanStack Query.** ~13 kB min+gzip, which is not the cost. Adopting it for one query would
  leave two ways of reading data next to `useIpcResource`; adopting it everywhere is a
  migration of its own. Its defaults also need overriding here: `networkMode: 'online'` pauses
  queries while `navigator.onLine` is false, which is only acceptable with a reconnection
  notice the launcher does not have ([ADR-0009](0009-no-offline-mode.md)), and three retries
  with backoff on top of `firestoreService`'s timeout race would delay every error. It does not
  reduce reads by itself either: `staleTime` does, and focus refetching adds them. Worth
  reopening only to unify every read under one cache, with its own ADR.
- **Refresh when the player selects a modpack.** The list would change under the click that
  caused it, and a newly published modpack would still not appear until the player picked a
  different one.
- **Realtime (`onSnapshot`).** Rejected earlier: it needs the full Firestore SDK (~320 kB more
  in the initial chunk, a persistent connection) and queues reads offline, which
  [ADR-0009](0009-no-offline-mode.md) ruled out.
