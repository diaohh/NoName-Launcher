import type { ManifestPointer } from '../../shared/modpack'
import type { FilePolicy, PolicyRule } from '../../shared/PackPolicy'

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
    hash: string
    size: number
    policy?: FilePolicy
}

export interface ManifestLoader {
    /** `fabric`, `forge`; anything else is refused when the loader is installed. */
    type: string
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
