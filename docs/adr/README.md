# Architecture Decision Records

One file per decision that would otherwise be re-argued from scratch: why the launcher is
built this way, what the alternative cost, and which invariants a future change must not
break.

## What goes here, and what does not

| File | Holds |
|------|-------|
| `docs/adr/` | The **why**. Written once, never rewritten — a decision that changes is *superseded* by a new ADR, so the reasoning that led to the old one survives |
| `CLAUDE.md` | The **rule**, stated so it can be applied while editing, linking to its ADR for the reasoning |
| `TODO.md` | Work that is still pending. Not an archive |
| `README.md` | The public face: what the launcher does and how to run it |

`CLAUDE.md` is in `.gitignore` — it is local agent guidance and does not ship with the repo.
Anything a contributor must know to not break the launcher therefore belongs **here or in the
README**, not only there. When a rule exists in `CLAUDE.md` alone, it is invisible to everyone
who clones the project.

Write an ADR when a decision is **structural** (it constrains code that has not been written
yet), **contested** (a reasonable person would pick differently), or **deferred** (the reason
for *not* doing something now is worth keeping). A bug fix is not an ADR. A convention with
no alternative is not an ADR.

## Writing one

Copy [`0000-template.md`](0000-template.md), take the next number, name the file in
kebab-case. Status is `Proposed`, `Accepted`, `Stand-by` or `Superseded by NNNN`. Add the row
to the table below in the same commit.

Alternatives marked **(reconstructed)** were not weighed when the decision was made; they were
written down afterwards as plausible roads not taken. Everything unmarked was a real option at
the time. ADRs 0001–0007 were backfilled on 2026-09-01 from the prose already in `CLAUDE.md`
and `TODO.md`, so their Context and Decision sections restate decisions that were genuinely
made — but only the marked alternatives distinguish what was actually rejected then.

## Index

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-manifest-on-cdn-with-firestore-pointer.md) | Distribute modpacks with a CDN manifest and a Firestore pointer | Accepted |
| [0002](0002-ipc-error-envelope.md) | Carry IPC errors in a result envelope with shared codes | Accepted |
| [0003](0003-minecraft-1-17-minimum.md) | Support Minecraft 1.17 and newer only | Accepted |
| [0004](0004-two-roots-launcher-and-data-directory.md) | Keep two roots: a fixed launcher directory and a movable data directory | Accepted |
| [0005](0005-single-progress-contract-and-phase-map.md) | One progress payload and a fixed phase map | Accepted |
| [0006](0006-usersallowed-is-ux-not-access-control.md) | `usersAllowed` is UX, not access control | Stand-by |
| [0007](0007-encrypt-account-secrets-with-safestorage.md) | Encrypt account secrets with `safeStorage`, and never fall back to plaintext | Accepted |
| [0008](0008-useeffect-only-for-external-systems.md) | Use `useEffect` only to synchronize with an external system | Accepted |
| [0009](0009-no-offline-mode.md) | No offline mode: report the network failure instead | Accepted |

## Not written yet

Decisions already taken and documented in prose in `CLAUDE.md` or `TODO.md`, worth extracting
when they are next touched:

- **State in the Context API, no Redux** — four providers, why the launcher's state is small
  enough and what `StatusContext` replaced.
- **No test runner** — verification through throwaway esbuild-bundled scripts, why the sources
  cannot run under plain node, and what that costs.
- **Mod loaders are ours, not helios-core's** — Fabric via the Meta API, Forge via the
  official installer, NeoForge planned and the version-id trap.
- **CJS preload, `sandbox: true`, CSP applied through `webRequest`** — and why the full ESM
  migration is deferred because of it.
- **Deliberately non-uniform indentation**, with ESLint enforcing per-area rather than
  picking a winner.
