# 0013. Let the game outlive the launcher

- **Status**: Accepted
- **Date**: 2026-11-05
- **Commit**: not committed yet

## Context

Closing the launcher with Minecraft open had no policy (audit 2026-09-17, B12), and the audit
assumed the game was left orphaned with a broken stdout. On Windows it is worse: it was measured
on 2026-11-05 with `child_process.spawn` and a real `javaw.exe`, and a child spawned with
`detached: false` **dies when the launcher exits**, because libuv assigns non-detached children to
a job object with kill-on-close. Closing the launcher killed the game with everything that had
not been saved, and nothing warned the player.

With `detached: true` the same JVM kept running after its parent exited, writing to both streams:
the pipe broke, `PrintStream.checkError()` turned true, and Java carried on. A Node child in the
same situation crashes on the broken pipe, so the result only holds for the JVM.

Closing during the *preparation* is a different case. Nothing is running yet; what is lost is a
download in progress, and cancelling a launch is itself on stand-by (helios' download queue cannot
be aborted mid-file; see `TODO.md` P4).

## Decision

- The game is spawned **detached** and survives the launcher. Closing the launcher while playing
  asks nothing.
- On quit (`will-quit`), `LaunchManager.releaseGame()` destroys the child's pipes and `unref()`s
  it, and nothing else.
- `running-game.json`, next to `config.json`, records `{ pid, gameDir }` from spawn until the
  child's `close`. A new session treats it as a running game only when the PID is alive **and** its
  command line contains `gameDir` (`--gameDir` is on every Minecraft command line this launcher
  builds). While it is, launching and changing the data directory are refused; a record that fails
  either check is stale and deleted.
- Closing while a launch is being prepared is held in main and confirmed in the renderer ("Seguir
  aqui" / "Salir"). Leaving simply ends the process; the next launch re-validates every file by
  hash.

## Consequences

- A launcher reopened during a game does not show it as running: the button reads JUGAR, and
  pressing it explains that Minecraft is still open. There is no kill button for such a game and
  no exit event, because the launcher no longer holds a handle to it. Adopting it (status, kill,
  polling for exit) is possible on top of the record if it is ever wanted.
- The orphan check costs a PowerShell start on Windows (about 0.4 s warm, more on a cold machine,
  capped at 15 s). It only runs when the record exists. If the command line cannot be read, the
  guard gives way rather than block the player, which is the behaviour from before it existed.
- A PID check alone would have been wrong: PIDs are reused, and refusing to launch because an
  unrelated program inherited the number would block the player indefinitely.
- `windowsHide` must stay `false` on the game spawn: Windows applies it to the JVM's first
  window, which is the game's own.
- Interrupting the preparation can, in the worst case, cut a JDK extraction halfway. The archive is
  re-downloaded next time, but a half-extracted runtime that still validates is not detected.

## Alternatives considered

- **Confirm, then close the game too.** One modal and no `detached`, but it keeps the current
  behaviour — the game dies with the launcher — and only adds a warning in front of it.
- **Confirm with options** ("close only the launcher" / "close both" / "cancel"). Also needs
  `detached`, and asks a question on every close for an answer that is almost always "leave my
  game alone".
- **Hide to the tray instead of closing.** Keeps the handle and the logs, but a launcher that
  ignores its close button is a surprise of its own, and it needs a tray icon and menu that do not
  exist.

## Addendum (2026-11-09)

- The game's lifecycle moved out of `LaunchManager` into `GameProcess` when it was split:
  `releaseGame()`, `killGame()`, `findOrphanGame()`, `running-game.json` and the spawn itself
  (`GameProcess.start`). The decision stands as written; read `LaunchManager.releaseGame` above as
  `GameProcess.releaseGame`.
