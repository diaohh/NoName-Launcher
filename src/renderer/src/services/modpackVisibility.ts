import type { Modpack } from '../../../shared/modpack'

/**
 * Whether the catalogue lists this modpack for this player: public, enabled, and either open to
 * everyone (`usersAllowed` empty) or naming their Minecraft username.
 *
 * The one copy of the rule. `getModpacks` applies it to the list and `prepareLaunch` to the copy
 * it re-reads when JUGAR is pressed, so a modpack withdrawn while the launcher was open cannot
 * be launched from the stale list. `usersAllowed` is UX, not access control (ADR-0006): the
 * whole collection is readable without it.
 */
export function isVisibleTo(modpack: Modpack, username: string | null): boolean {
  if (modpack.isPublic !== true || modpack.enabled !== true) return false

  const allowed = modpack.usersAllowed ?? []
  return allowed.length === 0 || (username != null && allowed.includes(username))
}
