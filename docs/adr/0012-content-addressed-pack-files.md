# 0012. Store pack files in the bucket by content hash

- **Status**: Proposed
- **Date**: 2026-09-17
- **Commit**: —

## Context

[ADR-0001](0001-manifest-on-cdn-with-firestore-pointer.md) split the data so that the Firestore
pointer is the only mutable state, and stated that this made publishing atomic and rollback a
pointer flip. The audit of 2026-09-17 found that this holds for the **manifest** and not for
the **files**:

- Files are stored at `<packId>/files/<path>`, so a file is identified by its path, not by its
  content.
- `publish.mjs` uploads them with `rclone sync`, which overwrites changed files and deletes
  removed ones in place.

Two consequences follow. While a new version is uploading, the pointer still names the old
manifest but the CDN already serves some new files, so launches fail with a checksum error
unless `maintenance` is raised first — a manual step that also does not stop a launch that
re-read the document just before. And pointing the hash back at an older manifest restores
nothing, because that version's files are gone.

The manifest already carries a sha256 for every file, so the information needed to address
files by content is already published.

## Decision

*Proposed, not yet taken.*

- Every file is uploaded to `<packId>/objects/<hash[0:2]>/<hash>`, where `hash` is the
  manifest's sha256 for it. The launcher composes the download URL from the hash instead of
  the path; `path` stays the destination inside the instance.
- `publish.mjs` uploads with `rclone copy` of the objects that are missing, **never `sync`**.
  An object, once written, never changes.
- The manifest gets `formatVersion: 2`. `ManifestManager`, `generate.mjs`, `publish.mjs` and
  `docs/manifest.md` change in the same commit, and the launcher keeps reading `formatVersion`
  1 until every published pack has moved.
- Deleting unreferenced objects is a separate, deliberate garbage-collection step that keeps
  every object referenced by the last N published manifests.

## Consequences

- Publishing becomes atomic in the sense ADR-0001 intended: nothing a player can download
  changes until the pointer flips, and rolling back is flipping it back.
- `maintenance` goes back to being what its name says — a way to close a pack for a while — and
  is no longer a correctness step of every publish.
- Two files with the same content, within a pack or across versions, are stored once.
- The bucket only grows until garbage collection runs; that step needs its own tool and must
  never delete an object that a live pointer still references.
- Browsing the bucket by hand stops being meaningful: `objects/ab/ab12…` says nothing about
  which mod it is. The manifest is the index.
- The URL no longer carries a filename, so `ManifestManager.fileUrl` stops needing
  `encodeURIComponent` for names with spaces and brackets.

## Alternatives considered

- **Keep path addressing and make `maintenance` mandatory.** This is the status quo. It costs
  nothing to build, but it relies on a manual step, leaves a race for launches already under
  way, and gives no rollback.
- **Version prefix (`<packId>/<version>/files/<path>`).** Also immutable and simpler to browse,
  but every version re-uploads the whole pack, hundreds of MB for a one-mod change, and the
  bucket grows by the full pack size per publish.
- **Sign the manifest.** Solves a different problem (a compromised CDN) and does nothing for
  atomicity. See ADR-0001.
