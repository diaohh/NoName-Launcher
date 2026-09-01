# 0003. Support Minecraft 1.17 and newer only

- **Status**: Accepted
- **Date**: 2026-08-14
- **Commit**: `f80a6b1`

## Context

Mojang changed the version manifest between 1.16 and 1.17. Older releases describe the
command line with a single `minecraftArguments` string instead of the structured
`arguments` object with rules, and they ship native libraries as **classifiers** inside the
library list, which the launcher must download, extract and point `-Djava.library.path` at.

The launch pipeline was built for the modern shape. Fed a 1.16 manifest it did not fail — it
built a command line with no natives and spawned a JVM that crashed with a linker error, so
the player saw the game "start" and vanish with nothing useful in the log.

## Decision

**The supported range is Minecraft 1.17+.** `assertSupportedVersion` rejects anything older
up front with `UNSUPPORTED_MC_VERSION`, before any download happens.

Do not add partial support. Accepting an older version means implementing natives extraction
and the `minecraftArguments` path together, in one change, or not at all.

## Consequences

- A player selecting an old modpack gets an explicit message instead of a game that dies on
  startup.
- No natives extraction code exists anywhere in the launcher, and nothing should assume it
  does. `resolveLibraryArtifact` handles two library shapes (Mojang/Forge `downloads.artifact`,
  Fabric Maven `name` + `url`) and neither is a classifier.
- The cut is stated in the README so pack authors know before they publish.
- Loader support inherits the floor: Fabric and Forge are supported *for 1.17+*, not in
  general.

## Alternatives considered

- **Support everything.** Natives extraction is a real feature with its own failure modes
  (partial extraction, locked files on Windows, per-OS classifier selection). It buys reach
  into versions this launcher's modpacks do not target.
- **Let it try and fail.** What happened before, and the failure is unreadable — a JVM
  linker error tells the player nothing.
