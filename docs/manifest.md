# Modpack manifest

The contract between `tools/pack-publish` (which writes it) and the launcher (which reads
it). Any change here means changing both sides in the same commit.

## Where it lives

```
<packDir>/
  pack.config.json     generator input
  manifest.json        generator output — NOT inside files/
  files/               synced to the CDN
    mods/*.jar
    config/**
```

On the CDN it becomes `<bucket>/<packId>/manifest.json` and `<bucket>/<packId>/files/**`.

## URL resolution

**The manifest contains no URLs.** The launcher takes `manifest.url` from Firestore, strips
the `/manifest.json` suffix to get the base, and composes:

```
<base>/files/<file.path>
```

Moving from a development subdomain to a custom domain is therefore one Firestore field per
modpack — no manifest to regenerate, nothing to re-upload. It is also what lets the
generator run with no network and no credentials.

Mod filenames routinely contain spaces and brackets, so the launcher encodes each path
segment with `encodeURIComponent` before joining (`ManifestManager.fileUrl`).

## Schema

```jsonc
{
  "formatVersion": 1,
  "packId": "example",
  "version": "1.0.0",              // informational, shown in the UI
  "minecraft": { "version": "1.20.1" },
  "loader": { "type": "fabric", "version": "0.19.3" },

  "policies": [                    // per-path rules, see below
    { "path": "mods", "policy": "strict" },
    { "path": "options.txt", "policy": "seed" }
  ],
  "ignore": ["saves/**", "**/*.cache.json"],

  "fileCount": 299,
  "totalSize": 358612480,

  "files": [
    { "path": "mods/example.jar", "hash": "<sha256>", "size": 481234, "policy": "strict" }
  ]
}
```

Format notes:

- `path` **always** uses POSIX separators (`mods/x.jar`), including when generated on
  Windows.
- `hash` is lowercase hex sha256. **It is mandatory on every entry.** The launcher must
  treat a missing hash as an error, never as "the file exists, good enough" — that was the
  old behaviour and it froze files at whatever version the player already had, silently.
- `files` is **sorted by `path`** and the manifest carries **no timestamp**, so regenerating
  an unchanged pack produces a byte-identical file. The manifest hash moves only when the
  content moves.
- `path` is **relative to the instance and must stay inside it**: no leading `/`, no drive
  letter, no `\`, no `..` segment. The generator produces such paths by construction, since it
  walks `files/`. The launcher rejects a manifest with any other shape (`MANIFEST_INVALID`)
  before touching a file. That covers `files[].path`, `policies[].path` and
  `loader.installer.path`, and every write or delete is also resolved inside the instance
  (`PathUtils.resolveInside`).
- The manifest hash is the sha256 of the **bytes** of `manifest.json`, written as UTF-8 with no
  BOM. The launcher currently hashes the decoded text, which gives the same result only for
  that encoding, so do not save the file with a BOM.

## Three distinct concepts

| Concept | Decides | Effect |
|---|---|---|
| `ignore` (globs) | What never enters the manifest | Never uploaded, never downloaded, **and skipped by orphan deletion** |
| `policies` (paths) | How declared paths behave | See the table below |
| `files` | The actual contents | What to download and which hash validates it |

The second half of `ignore` is the critical part. If `config/**` is `strict` and
`config/foo/links.cache.json` is not in the manifest, the launcher would delete it as an
orphan on every launch and the mod would immediately recreate it. That is why `ignore`
travels inside the manifest and orphan scanning has to honour it.

## Policies

| Policy | Downloads when missing or different | Deletes unknown files | Used for |
|---|---|---|---|
| `strict` | yes | **yes** | `mods`, `config`, `scripts`, `kubejs` |
| `seed` | only when missing | no | `options.txt`, `servers.dat` |
| `additive` | yes | no | `resourcepacks`, `shaderpacks` |
| `ignore` | no | no | `saves`, `logs`, `screenshots` |

Resolution: the rule whose `path` is the **longest matching prefix** wins. A file matching
no rule falls back to `strict`, and the generator prints a warning so an explicit rule can
be added.

Files whose resolved policy is `ignore` are left out of `files` — declaring them would have
no effect, since the launcher never touches them.

## Firestore state

```js
modpacks/<packId>: {
  maintenance: false,
  maintenanceMessage: "",
  manifest: {
    url:     "https://<cdn-host>/<packId>/manifest.json",
    hash:    "<sha256 of manifest.json>",
    version: "1.0.0"
  }
}
```

`manifest.hash` lets the launcher skip downloading the manifest when nothing changed, and
verify that what it downloaded is what Firestore points at — worth having because
`manifest.json` is served from a fixed, therefore cacheable, URL.

The full list of fields on the document (name, visuals, `usersAllowed`, RAM…) is in the
README's "Modpack document" table.

## Publishing and rollback

The pointer makes the **manifest** atomic: the launcher only reads a manifest whose hash
matches Firestore, and the manifest is cached by that hash. The **files are not**. They live
at `<packId>/files/<path>`, addressed by path rather than by content, and `publish.mjs`
uploads them with `rclone sync`, which overwrites and deletes them in place. So:

- **During an upload**, Firestore still points at the old manifest while the CDN already
  serves some new files. A player launching then fails with a checksum error. The
  `maintenance: true` step in the publishing cycle
  ([tools/pack-publish/README.md](../tools/pack-publish/README.md)) exists to prevent that, and
  it is **not optional**. It also does not stop a launch that re-read the document before the
  flag went up.
- **Rolling back is not flipping the pointer back.** The old version's files have already been
  overwritten or deleted, so it means regenerating and re-uploading the old pack folder.

Making the bucket genuinely immutable — objects keyed by their sha256, uploaded with `copy`
and never `sync` — is proposed in
[ADR-0012](adr/0012-content-addressed-pack-files.md). It changes this contract
(`formatVersion` 2).

## Local instance state

The launcher writes `<instanceDir>/.nnl-state.json`, recording the hash, size and mtime of
every file it placed. When size and mtime still match, it trusts the recorded hash instead
of re-hashing hundreds of megabytes on every launch. Losing the file costs one slow launch,
never correctness.

## Pending

- **Content-addressed files.** See "Publishing and rollback" above and
  [ADR-0012](adr/0012-content-addressed-pack-files.md).

- **Forge.** The generator refuses any `loader.type` other than `fabric` on purpose.

  The launcher side already expects this field, reserved and **not yet exercised**:

  ```jsonc
  "loader": {
    "type": "forge",
    "version": "47.2.0",
    "installer": { "path": ".loader/forge-installer.jar" }   // relative to the instance
  }
  ```

  The idea is to publish the installer as just another manifest file, with no special
  handling: it downloads like anything else and `ModLoaderManager.installForge` runs it
  with `--installClient <commonDir>`, so its location does not matter. The generator (and
  `pack.config.json`) still need to learn to produce it before this path can be trusted.

  Fabric needs none of this: its profile JSON is published ready-made by Fabric Meta, so
  the loader costs zero bytes in the bucket. Forge only exists after running an installer
  that binary-patches the vanilla jar, which is the whole asymmetry.
