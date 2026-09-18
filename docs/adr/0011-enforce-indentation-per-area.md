# 0011. Enforce the indentation each area already uses, instead of unifying it

- **Status**: Accepted
- **Date**: 2026-08-31
- **Commit**: `bdd6e36`

## Context

The codebase has two indentation styles. `src/main/managers`, `src/main/utils` and
`src/main/windows` were written at 4 spaces; `src/main/index.js`, `src/main/ipc`,
`src/preload`, `src/shared` and the whole renderer at 2.

Adding ESLint forced a choice, because a linter that ignores indentation is not doing the job
and one that enforces a single width rewrites half the tree.

Several of the 4-space files — `LaunchManager`, `AuthManager`, `ConfigManager` — are the ones
under active change, with open items against them in `TODO.md`. A whole-tree reformat would put
a mechanical commit on top of every one of them, so `git blame` on the lines that matter would
point at the reformat rather than at the change that introduced the behaviour.

## Decision

**The linter enforces what each area already uses.** `eslint.config.mjs` carries two
`@stylistic/indent` blocks selected by glob — 4 for `managers`/`utils`/`windows`, 2 for
everything else — and `CLAUDE.md` states the rule as "match the file you are editing".

Unification is deferred to the `typescript-eslint` sweep in P5, where the files are being
rewritten anyway and the reformat rides along with a change that has its own reason to exist.

`tools/` is excluded entirely: it runs on plain node, outside the bundle.

## Consequences

- The repo stays at **0 ESLint errors**, and that is the standard for a change to land.
- A contributor cannot infer the style from the last file they read. The rule has to be stated,
  which is why it is in `CLAUDE.md`, in the README's contributing notes and in the header
  comment of `eslint.config.mjs`.
- Two configuration traps had to be worked around, both worth knowing before touching that file:
  - `eslint-plugin-react` with `settings: { react: { version: 'detect' } }` **crashes the whole
    run** on ESLint 10 — detection reaches for a context API that only ESLint 9 has. The version
    is pinned to `'19.0'` for that reason, and pinning has to be revisited on a React upgrade.
  - `@stylistic/indent` reflows template literals, and in this codebase those hold Tailwind class
    lists laid out for readability. Left alone it makes them unreadable, so `TemplateLiteral *`
    is in `ignoredNodes` for the renderer.
- `react-refresh/only-export-components` is off: all four contexts export their provider and
  their `use*` hook from the same file on purpose, so the rule fires four times and would never
  be acted on.
- One warning is left standing rather than silenced — a missing dependency in
  `DynamicBackground.jsx`. It is a real defect with an open item against it, and suppressing it
  would lose the only automated signal pointing at it.

## Alternatives considered

- **Unify on 2 spaces now.** The majority style, and the smaller diff of the two. Still rewrites
  every manager, which is where the active work is.
- **Unify on 4 spaces now.** Rewrites more files than the alternative above, for the same cost.
- **Prettier over the whole tree.** Settles indentation and much else in one step, and is what
  most projects would do. Same objection, larger: it reformats every file rather than the
  disputed ones, and it takes quoting, line width and trailing commas with it — decisions nobody
  asked to make in a commit whose stated purpose was "add a linter".
- **No indentation rule at all.** *(reconstructed)* Costs nothing today and drifts, which is how
  the split arose in the first place.

## Addendum (2026-09-17)

The `DynamicBackground.jsx` warning mentioned above is gone: the effect it pointed at was
removed when the banner started loading through a hidden `<img>`, and the repo is at 0 errors
and 0 warnings.
