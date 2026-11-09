# 0005. One progress payload and a fixed phase map

- **Status**: Accepted
- **Date**: 2026-08-29
- **Commit**: `ae73894`, `4823677`

## Context

The launch flow crosses six managers, and each reported progress its own way: some passed
`(current, total, message)` positionally, some an object, some invented a `type` for a phase
they could not actually know they were serving. The renderer mapped whatever arrived onto a
percentage computed as `current / total`.

Two visible failures came out of that. The bar sat at "Validando archivos" while real work
happened, because a phase that cannot count anything reported nothing. And the bar ran
**backwards**: `download` was emitted twice — once for vanilla assets, once again for the
loader libraries — so the second phase restarted the count.

## Decision

- **One payload shape for the whole chain**: a single object `{ current, total, message }`.
  Do not add a positional signature back.
- The managers underneath **do not set `type`**. They do not know which launch phase they are
  serving. `LaunchManager` is the only layer that adds it. `MinecraftDownloadManager` carries
  its own sub-phase as `phase`, which is a different axis.
- Each `type` owns a **fixed slice of the bar** in `renderer/services/launchPhases.js`, and
  the fraction inside a phase maps into that slice. A phase that cannot count anything sits
  at its floor, which is still forward movement.
- `LaunchContext` holds a monotonic ceiling: the bar never retreats, whatever order events
  arrive in.
- **A `type` appears exactly once in the flow.** A type emitted at two points makes the bar
  run backwards, which is why loader libraries have their own `download_libraries` instead of
  reusing `download`.

## Consequences

- Adding a phase means touching three files in the same change: `LaunchManager` (emit),
  `LaunchContext` (a `case`), and `launchPhases.js` (a slice). Miss the last two and the step
  runs while the bar freezes on the previous message — it fails silently, which is the worst
  property of this contract and the reason it is written down.
- The type set is closed and listed in `CLAUDE.md`: phases, lifecycle (`started`, `exit`,
  `error`), and game output (`stdout`, `stderr`).
- The slices are hand-tuned weights, not measurements. They are allowed to be wrong about
  duration; they are not allowed to overlap or repeat.
- Making the `launch:progress` payload a discriminated union is the second-highest-value item
  in the TypeScript migration (P5): it turns "missing `case`" from a frozen UI into a
  compile error.

## Alternatives considered

- **Compute the percentage purely from `current / total` across the whole flow.** Requires a
  total known up front, which no step can produce before the manifest is read.
- **Let each manager own its `type`.** What existed. A manager cannot know whether it is
  downloading vanilla assets or loader libraries; that is exactly how `download` came to be
  emitted twice.
- **Indeterminate spinner for phases that cannot count.** Honest, but the launcher spends
  most of a first launch in those phases, and a spinner for four minutes reads as a hang.

## Addendum (2026-11-05)

- The type set gained `game_startup`, which drives a **second** bar, from `started` to the
  title screen, fed by milestones in the game's output (`main/utils/StartupTracker.js`). It is
  the one type that repeats and the one with no slice in `PHASE_RANGE`: it arrives after the
  preparation bar has reached 100%, so it is measured on its own 0-100 scale and cannot make the
  first bar run backwards. Its payload adds `done`, and `current` is null while no milestone
  has been recognised (an indeterminate bar).
- `stdout`/`stderr` now carry `lines: string[]` (whole lines, split before any trim) instead
  of `data`, the raw chunk.

## Addendum (2026-11-06)

- The two bars are back to **one**, shown as four steps (`LAUNCH_STEPS` in `launchPhases.js`:
  Verificar, Descargar, Preparar, Iniciar). Stacked, the second bar covered JUGAR and its kill
  button during the game's startup, and the first one sat at 100% doing nothing next to it.
- Each step's stretch fills 0–100 on its own, instead of one continuous bar weighted by
  `PHASE_RANGE`. Those weights cannot be right for both a cold instance (downloads dominate) and
  a warm one (the game's startup dominates), and a continuous bar would leap to ~70% and then
  stall for the whole startup on every warm launch.
- The contract above is unchanged: payloads, the once-only rule and the slices all stand. The
  preparation steps are cuts across `PHASE_RANGE` and a phase belongs to the step its floor falls
  in, so the slices remain the only table a new phase has to be added to. `game_startup` is the
  last step, still on its own scale and still outside `PHASE_RANGE`.

## Addendum (2026-11-07)

- The contract is now a type. `LaunchProgress` in `src/shared/launchProgress.ts` is a
  discriminated union on `type` — phases, lifecycle, `game_startup`, `stdout`/`stderr` — and
  `LaunchManager.launchMinecraft` takes a callback typed with it. `StepProgress` is the
  `{ current, total, message }` the managers underneath report.
- `PHASE_RANGE` and `PHASE_LABEL` are `Record<PhaseType, …>`, so a phase with no slice is a
  compile error. The test that read the `type` literals out of `LaunchManager`'s source to
  check the same thing was removed with it.
- What the compiler cannot see yet is `LaunchContext`'s switch, which is still JavaScript; its
  exhaustiveness check (`never` in the `default`) comes with the renderer's conversion.

## Addendum (2026-11-08)

The renderer is TypeScript now, and `LaunchContext`'s switch assigns the event to `never` in its
`default`: a `type` of the union with no `case` does not compile. Every way the bar could freeze
on the previous message without an error (a phase with no slice, a phase with no `case`) is now
a compile error.

## Addendum (2026-11-09)

- `LaunchManager` was split (`TODO.md` P2). The rule "only `LaunchManager` adds `type`" now has
  two stated exceptions, each the one module that knows its events: `JavaManager` sets Java's own
  sub-phases (`java_discover`, `java_download`, `java_extract`; its callback is typed with just
  those), and `GameProcess` sets the running game's events (`started`, `game_startup`,
  `stdout`/`stderr`, `exit`), which are lifecycle, not phases. Every other manager still reports
  `{ current, total, message }`; `LaunchCommand.downloadModLoaderLibraries` was brought back to
  that shape, and `LaunchManager` adds `download_libraries` to it.
