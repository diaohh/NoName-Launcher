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
