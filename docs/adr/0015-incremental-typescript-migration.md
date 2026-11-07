# 0015. Migrate to TypeScript incrementally, strict in every `.ts` file

- **Status**: Accepted
- **Date**: 2026-11-07
- **Commit**: `f91d49b` (the infrastructure; this record lands with the docs of the same branch)

## Context

The launcher is ~8,800 lines of JavaScript (main ~5,000, renderer ~3,600), nearly double what
it was when the migration was first estimated on 2026-09-17. The defects that cost the most
are not logic errors but contracts that drift apart without anything failing:

- An IPC call has to exist in four layers (channel, handler, preload, `ipcClient`); one that is
  missing from any of them is dead, and nothing says so.
- A launch progress `type` with no slice in `PHASE_RANGE` runs, and the bar freezes on the
  previous message (ADR-0005).
- Errors carry a string `code` assigned by hand in ~34 places; a typo is a silent mismatch on
  the renderer's side.
- `config.json`, the manifest, the Firestore document and the Mojang and Fabric JSON are read
  by shape, and only the code that reads them knows that shape.

The migration has to coexist with ongoing work on `TODO.md`, and has to be checkable step by
step: a conversion that changes behaviour must be caught, not discovered at launch time. That
is why Vitest and a minimal set of characterization tests landed first (Fase 2), and why
Electron was upgraded before any `.ts` file existed (Fase 1), so its regressions would not be
mixed with the migration's.

## Decision

**Convert file by file, with `allowJs`, and hold every `.ts` file to `strict` from the day it
is written.**

- Two projects: `tsconfig.node.json` (main, preload, `src/shared`) and `tsconfig.web.json`
  (renderer, `src/shared`), referenced from a solution `tsconfig.json`. The web project has no
  node types, because the renderer is sandboxed and has no `process`, `Buffer` or `fs`.
- `allowJs: true`, `checkJs: false`: JavaScript is part of the program, so `.ts` files can
  import it, but it is not checked. Nothing gets JSDoc annotations that would be thrown away a
  few weeks later.
- electron-vite strips types and never checks them, so `pnpm typecheck` (`tsc --noEmit` on
  both projects) is part of the definition of done, next to `pnpm lint`, `pnpm test` and
  `pnpm build`.
- **Every new file is `.ts`/`.tsx`.** An existing file is converted with `git mv` plus types in
  one commit, with no refactor inside it; a file that asks to be split is split in a commit of
  its own, before or after.
- **TypeScript does not validate data.** Whatever crosses a trust boundary — an IPC argument,
  the manifest, the Firestore document, Mojang or Fabric JSON, `config.json` — enters as
  `unknown` and becomes typed only through a runtime check written as a type guard. The checks
  that already exist (`assertShape`, `validateConfig`, `parseProfile`, `toModpack`) become
  those guards. Mojang and Fabric types are written by hand, with only the fields that are read.
- **No schema library.** The handful of external shapes is covered by the hand-written
  validators above.
- Errors are thrown as a `LauncherError` whose `code` is an `ErrorCode`, the union of
  `src/shared/errorCodes` (Fase 4), instead of assigning `error.code` by hand.
- Indentation stays per area (ADR-0011, addendum of 2026-11-07); the ESLint globs cover
  `.ts`/`.tsx` and `typescript-eslint` adds the parser and its recommended rules.
- **TypeScript is pinned to 6.0.x.** `typescript-eslint` 8 supports `<6.1`, and TypeScript 7
  (the native compiler) does not yet expose an API it can use.

## Consequences

- The contracts listed above become compile errors once Fase 4 types them: a channel missing
  from one layer, a progress `type` with no slice, an unknown error code.
- Until the last file is converted the checker sees through JavaScript only by inference: a
  `.ts` file importing a `.js` one gets whatever TypeScript can infer from it, and the
  JavaScript side gets no checking at all. The safety net for the conversion itself is the
  test suite, not the type checker.
- A runtime guard and the type it narrows to are written separately and can drift. Each guard
  lives next to its type, and the tests cover the guards that protect the launch.
- `composite: true` in both projects keeps editors happy with the solution file; the
  `typecheck` scripts pass `--composite false` together with `--noEmit`, since nothing is ever
  emitted by `tsc`.
- Moving to TypeScript 6.1 or 7 waits for `typescript-eslint`.
- The migration does not depend on ESM: electron-vite still emits the sandboxed preload as CJS
  from a `.ts` source.

## Alternatives considered

- **Convert everything at once.** A single diff over every file, which nobody can review, and
  a freeze on the rest of `TODO.md` until it lands. Rejected for both reasons.
- **`checkJs` enabled folder by folder, with JSDoc**, as the 2026-09-17 analysis proposed.
  Catches errors in JavaScript before it is converted, but every error it reports has to be
  fixed with JSDoc annotations that are rewritten as TypeScript shortly after. The tests buy
  the same safety without the throwaway work.
- **A schema library (zod, valibot).** One declaration yields both the runtime check and the
  type, which removes the drift noted above. It costs a dependency in both bundles and a
  rewrite of validators that already exist and are already tested by hand; with five or so
  external shapes, that trade did not pay. Worth revisiting if the number of shapes grows.
- **TypeScript 7.** Much faster, and the current release. `typescript-eslint` cannot use it
  yet, and losing typed linting was the larger cost.
- **Stay on JavaScript and rely on tests.** *(reconstructed)* Tests catch what someone thought
  to test; the four-layer IPC chain and the phase map fail precisely where nobody did.
