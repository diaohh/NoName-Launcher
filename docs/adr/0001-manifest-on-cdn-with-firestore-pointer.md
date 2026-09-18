# 0001. Distribute modpacks with a CDN manifest and a Firestore pointer

- **Status**: Accepted
- **Date**: 2026-08-28
- **Commit**: `1f135a3`, `34fbd43`, `2ca6008`, `d76f17e`

## Context

The launcher originally followed the HeliosLauncher model: a `distribution.json` describing
every server and every module, fetched whole, plus a `DownloadManager` of our own that
streamed files with `got` and hashed them with MD5 per module.

Three things broke down. The file was a single mutable blob, so a modpack update was visible
to players the moment the first file was uploaded — publishing was not atomic. Per-module
MD5 hashing froze the progress bar on "Validando archivos" for minutes. And the module tree
duplicated in Firestore what the file listing already said, so every update meant editing
the catalogue and the file list in two places and keeping them consistent by hand.

## Decision

Split the data by mutability.

- **Firestore** (`modpacks/{id}`) holds the catalogue and **a pointer only**: `manifest.url`,
  `manifest.hash` (sha256), `manifest.version`. There is no `modules` subcollection.
- **The pack manifest**, published to the CDN by `tools/pack-publish`, is the authority on
  what an instance contains: the file list with sizes and hashes, the per-path policies, and
  the mod loader.
- The launcher fetches the manifest and **verifies it against the hash in Firestore** before
  reading a byte of it. Verified manifests are cached at `manifests/<sha256>.json`.
- The manifest contains **no URLs**. The launcher strips `/manifest.json` off `manifest.url`
  to get the base and composes `<base>/files/<file.path>`.

## Consequences

- Publishing is atomic: nothing reaches players until `manifest.hash` is flipped, which is
  one field, one write.
- Moving CDN host or domain is one Firestore field per modpack. No manifest to regenerate,
  nothing to re-upload, and the generator runs with no network and no credentials.
- The hash makes the manifest tamper-evident; a mismatch is refused rather than launched.
- `minecraftVersion` on the Firestore document becomes **display-only** — it exists so the
  sidebar can show a version without fetching N manifests. Launching from it is a bug.
- The manifest schema is now a contract between two programs that ship separately
  (`tools/pack-publish` and the launcher). It is versioned (`formatVersion`) and documented
  in [manifest.md](../manifest.md); both sides change in the same commit.
- `PackPolicy` is **deliberately duplicated** in `tools/pack-publish/generate.mjs`: the
  generator runs on plain node and cannot import the extensionless launcher sources. The
  duplication is the price of keeping the generator dependency-free.
- `distribution.json` and `DownloadManager` are gone, along with the components that only
  existed to render them. Reintroducing either is a regression, not a feature.

## Alternatives considered

- **Keep `distribution.json`, make it atomic with versioned filenames.** *(reconstructed)* Would fix publishing
  but not the two-places-to-edit problem, and leaves the launcher owning a download engine
  that `helios-core/dl` already provides better.
- **Put the file list in Firestore.** Reads scale with file count (a modpack is thousands of
  entries), costs money per launch, and still needs a hash to be trustworthy.
- **Sign the manifest instead of hashing it.** *(reconstructed)* Real integrity against a compromised CDN, but
  needs key management and a rotation story. The sha256 pointer already closes the practical
  gap, because Firestore is the trusted side of the pair.

## Addendum (2026-09-17)

The first consequence above overstates what was built. The pointer makes the **manifest**
atomic, but the files are stored by path (`<packId>/files/<path>`) and `publish.mjs` overwrites
them in place with `rclone sync`. Publishing is therefore safe only while `maintenance` is
raised, and flipping the pointer back does not roll back, because the old files are gone. The
decision itself stands; the fix is proposed in
[ADR-0012](0012-content-addressed-pack-files.md), and `docs/manifest.md` ("Publishing and
rollback") describes the current behaviour.
