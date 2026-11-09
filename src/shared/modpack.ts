import type { Sha256Hex } from './guards'

/**
 * A modpack document from Firestore (`modpacks/{id}`), as the renderer hands it to main through
 * `distro:setServerData`. The README's "Modpack document" table describes every field.
 *
 * The renderer checks the visual fields it uses (`firestoreService.toModpack`); main reads its
 * own subset and validates it again (`DistributionManager.parseServerData`), since it cannot
 * trust anything that crosses the IPC boundary.
 */
export interface Modpack {
  id: string
  name: string
  description?: string
  /** Display only: the manifest is authoritative for launching. */
  minecraftVersion?: string
  icon?: string
  banner?: string
  logo?: string
  /** `#rgb` / `#rrggbb`, or null when the document has none or an invalid one. */
  accentColor: string | null
  isPublic?: boolean
  enabled?: boolean
  usersAllowed?: string[]
  order?: number
  java?: ModpackRam
  maintenance?: boolean
  maintenanceMessage?: string
  manifest?: ManifestPointer
}

/** The modpack's own RAM, in the JVM's format (`4G`, `4096M`). */
export interface ModpackRam {
  minRam?: string
  maxRam?: string
}

/**
 * The only mutable pointer to a published manifest (ADR-0001). `hash` is the sha256 of the
 * manifest's bytes, which the launcher checks before reading it.
 */
export interface ManifestPointer {
  url: string
  hash: Sha256Hex
  version?: string
}
