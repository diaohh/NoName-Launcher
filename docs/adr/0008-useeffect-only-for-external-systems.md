# 0008. Use `useEffect` only to synchronize with an external system

- **Status**: Accepted
- **Date**: 2026-09-01
- **Commit**: n/a (rule; the outstanding fixes are tracked in `TODO.md` P3)

## Context

`useEffect` exists to **connect a component to a system outside React** — the DOM, a timer,
a subscription, a network or IPC call. React's own documentation is explicit that if an
effect is not doing that, it usually should not exist: state derived from props or state
belongs in render, and a reaction to a user action belongs in the event handler that caused
it. An effect used for either runs a render late, tears and re-runs on every dependency
change, and turns a synchronous fact into a two-pass one.

An audit of the renderer (2026-09-01) found **8 effects and no misuse of the anti-pattern
kind**: no derived state, no prop-to-state copying, nothing that belonged in a handler. But
half of them are written without the discipline the pattern requires — missing cleanup,
missing cancellation, a dependency array that does not match what the body reads, no error
path. The rule below is therefore mostly preventive, plus a checklist for the ones that stay.

## Decision

Before writing a `useEffect`, it must be answerable which **external system** it synchronizes
with. If there is no answer, it does not get written.

Legitimate, in this codebase:

- **IPC subscriptions** — `ipc.launch.onProgress`, `ipc.events.onTokenExpired`.
- **DOM events outside the React tree** — the click-outside listener on the profile menu.
- **Timers** — the status-message fade, cleared on unmount.
- **Imperative DOM the tree cannot express** — the log auto-scroll.
- **Loading data on mount** — the account bootstrap, the modpack list, the settings screen.
  Legitimate only because there is no framework loader here; it carries the strictest
  obligations, below.

Not legitimate, no exceptions:

- Computing a value from props or state. Compute it in render.
- Reacting to a click, a toggle or a form change. Do it in the handler.
- Resetting state when a prop changes. Use a `key`, or lift the state.
- Chaining `useEffect` to another `useEffect`'s `setState`.

Every effect that stays satisfies all four:

1. **Cleanup.** Every subscription, listener and timer is removed in the returned function.
2. **Cancellation.** Every async effect guards against a stale resolution — an `ignore` flag
   set in cleanup, or an `AbortController`. Not optional because the component "only mounts
   once": StrictMode double-invokes in development, and a dependency change re-runs it.
3. **Honest dependencies.** The array lists everything the body reads. Reading a value the
   array does not declare is a bug, not a lint preference — `react-hooks` warnings are treated
   as errors in review even where ESLint reports them as warnings.
4. **An error path.** An awaited call that can reject has a `catch` that reaches the user
   through `useStatus()`, or at minimum leaves the UI out of its loading state. A screen stuck
   on "Cargando..." forever is the failure mode this prevents.

## Consequences

- The three fetch-on-mount effects (`AuthContext`, `useServers`, `SettingsScreen`) each
  reimplement their own loading/error state machine, and each does it incompletely. That is
  three callers, so a shared `useIpcResource`-style hook now clears the project's YAGNI bar
  — recorded in `TODO.md` P3 rather than built preemptively.
- `AuthContext`'s effect does two unrelated things (bootstrap fetch plus event subscription).
  Splitting them is on the same P3 item; the rule above is what makes it a defect rather than
  a style preference.
- The known violations at the time of writing are listed in P3 with file and line. New code
  is held to this ADR; the existing four are fixed on their own schedule.
- This does not ban effects, and "count the effects" is not the metric. An effect that
  subscribes to `launch:progress` is correct and should not be refactored away.

## Alternatives considered

- **Ban `useEffect` outright and route everything through contexts.** The contexts *are*
  where the subscriptions live; something still has to subscribe, and that something is an
  effect. The ban would only move it.
- **A data-fetching library (React Query and friends).** Solves cancellation, retries and
  caching properly, but adds a dependency to a renderer that already carries ~1.2 MB of
  Firebase (P5 wants that *smaller*), for three call sites over an IPC bridge that is
  local, fast and not cacheable in any interesting way.
- **Leave it to `react-hooks/exhaustive-deps`.** The lint rule catches dependency arrays only.
  It says nothing about cancellation, nothing about error paths, and nothing about whether the
  effect should exist — which is the part that is worth writing down.
