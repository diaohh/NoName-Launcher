# pack-publish

Publishing tools for modpacks. They turn a folder of mods and configs into a manifest
the launcher can sync against, and upload it to an S3-compatible CDN.

The manifest format is the contract between these scripts and the launcher — see
[`docs/manifest.md`](../../docs/manifest.md). `generate.mjs` and
`src/main/utils/PackPolicy.js` deliberately duplicate the glob and policy matching,
because the tools run on plain node while the launcher sources are bundled with
extensionless imports. **Change both together.**

## Pack layout

```
<packDir>/
  pack.config.json     input: loader, policies, ignore globs, CDN target
  manifest.json        output: written by generate.mjs, uploaded as-is
  files/               everything that ends up in the player's instance
    mods/*.jar
    config/**
```

`manifest.json` lives *outside* `files/`, so syncing `files/` never touches it.

## `pack.config.json`

```jsonc
{
  "packId": "example",
  "version": "1.0.0",
  "minecraft": { "version": "1.20.1" },
  "loader": { "type": "fabric", "version": "0.19.3" },

  "cdn": {                                  // optional, defaults for publish.mjs
    "remote": "r2",                         // rclone remote name
    "bucket": "my-bucket",
    "baseUrl": "https://<cdn-host>"
  },

  "policies": [
    { "path": "mods",          "policy": "strict"   },
    { "path": "config",        "policy": "strict"   },
    { "path": "options.txt",   "policy": "seed"     },
    { "path": "resourcepacks", "policy": "additive" },
    { "path": "saves",         "policy": "ignore"   }
  ],

  "ignore": ["saves/**", "**/*.log", "**/*.cache.json", "**/.index/**"]
}
```

Policies decide what the launcher does with each path; see the table in
`docs/manifest.md`. `ignore` keeps files out of the manifest **and** out of orphan
deletion — both halves matter.

## `generate.mjs` — manifest only

```bash
node tools/pack-publish/generate.mjs <packDir> [--version 1.2.0] [--out <path>]
```

Scans `files/`, computes sha256 and size for every file, writes `manifest.json`, and
prints the manifest's own sha256 — the value that goes into Firestore. No network, no
credentials. Use it to inspect a manifest before uploading anything.

Output is deterministic: `files` is sorted and there is no timestamp, so regenerating an
unchanged pack produces a byte-identical file. The manifest hash only moves when the
content really moves.

It fails on purpose when `loader.type` is not `fabric`, when Minecraft is older than
1.17, on an unknown policy, or when `version` is missing. It warns (without failing)
about files that match no policy rule, which are assumed `strict`.

## `publish.mjs` — generate, upload, and report

```bash
node tools/pack-publish/publish.mjs <packDir> [--remote r2] [--bucket name]
                                    [--base-url https://...] [--version 1.2.0] [--dry-run]
```

Checks that rclone exists and the remote is configured, runs `generate.mjs`, syncs
`files/`, uploads `manifest.json`, then prints the Firestore values. It does **not**
write to Firestore: that stays manual, so no service-account key has to exist.

`--dry-run` passes `--dry-run` to rclone and uploads nothing.

## Publishing cycle

1. Set `maintenance: true` on the modpack document in Firestore.
2. `node tools/pack-publish/publish.mjs <packDir>`
3. Paste the printed `manifest.hash` (and `version`) into the document.
4. Set `maintenance: false`.

The launcher re-reads the document when the player presses play, so step 1 blocks
launches for the few seconds the upload takes, and step 4 releases them.

## rclone setup

```
rclone config
  n → name: r2
  Storage: s3    Provider: Cloudflare    env_auth: false
  access_key_id / secret_access_key: from an "Object Read & Write" R2 API token
  region: auto
  endpoint: https://<account-id>.r2.cloudflarestorage.com
```

Keep the token in a gitignored `.env`; it is never read by these scripts, only by rclone.

## Gotchas

- **`sync`, not `copy`.** `publish.mjs` uses `rclone sync` so a mod removed from the pack
  is removed from the bucket. `copy` would leave it behind and the launcher would keep
  serving a file the manifest no longer declares.
- **`rclone sync` does not update metadata.** It compares size and modification time, so
  objects uploaded before `--header-upload` was added keep their old (or missing)
  `Cache-Control` forever. A later sync will not fix them. Force a re-upload of the
  affected prefix:
  ```bash
  rclone copy <packDir>/files/config <remote>:<bucket>/<packId>/files/config \
    --ignore-times --header-upload "Cache-Control: no-cache"
  ```
- **`Cache-Control` is per-object in R2**, not a bucket setting. It can only be set at
  upload time.
- **packwiz metadata.** `mods/.index/**` holds packwiz's `.pw.toml` files. The Minecraft
  client never uses them, so they must stay in `ignore`.
- **Runtime-generated files under a `strict` path.** Anything a mod rewrites while the
  game runs (`*.cache.json`, for instance) must be in `ignore`, or the launcher will
  delete it as an orphan on every launch and the mod will recreate it.
- **Disabled mods.** A `foo.jar.disabled` file works as-is, the suffix is just part of the
  path. If a player renames one to enable it, `strict` will undo that on the next launch.
