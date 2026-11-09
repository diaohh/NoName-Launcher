import type { ManifestPointer } from '../../shared/modpack'
import type { FilePolicy, PolicyRule } from '../../shared/PackPolicy'
import type { Sha256Hex } from '../../shared/guards'

/**
 * The pack manifest published to the CDN (docs/manifest.md), read by `ManifestManager` and
 * checked by its `assertShape` before anything trusts these types.
 */

// The policy types live with the matching rules, which tools/pack-publish imports too.
export type { FilePolicy, ManifestPointer, PolicyRule }

export interface ManifestFile {
    /** Relative to the instance, POSIX separators, checked by `isSafeRelativePath`. */
    path: string
    /** Lowercase hex sha256. Mandatory: a missing hash is an invalid manifest. */
    hash: Sha256Hex
    size: number
    policy?: FilePolicy
}

/** The loaders a manifest can declare; `ManifestManager.assertShape` refuses any other. */
export type LoaderType = 'fabric' | 'forge'

export interface ManifestLoader {
    type: LoaderType
    version?: string
    /** Forge's installer jar, published as an ordinary file of the pack. */
    installer?: { path: string }
}

export interface PackManifest {
    formatVersion: 1
    packId?: string
    /** Informational. */
    version?: string
    /** Authoritative for launching: the Firestore field of the same name is display only. */
    minecraft: { version: string }
    /** Absent for a vanilla pack. */
    loader?: ManifestLoader
    policies?: PolicyRule[]
    /** Globs never downloaded and never deleted as orphans. */
    ignore?: string[]
    files: ManifestFile[]
}
