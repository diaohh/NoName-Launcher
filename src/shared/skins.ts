/**
 * Limits of the skin vault that both processes enforce: the renderer to shape the inputs,
 * main because it cannot trust them.
 */
export const MAX_SKIN_NAME_LENGTH = 32

/** Mojang's two player models, in the spelling its upload endpoint takes. */
export const SKIN_VARIANTS = ['classic', 'slim'] as const

export type SkinVariant = typeof SKIN_VARIANTS[number]

export function isSkinVariant(value: unknown): value is SkinVariant {
  return (SKIN_VARIANTS as readonly unknown[]).includes(value)
}

/** A skin of the vault as the renderer lists it. `variant` is null until it is known. */
export interface SkinEntry {
  id: string
  name: string
  variant: SkinVariant | null
}

/** A vault entry with its texture, as a `data:` URL (ADR-0014). */
export interface SkinWithTexture extends SkinEntry {
  texture: string
}

export interface CapeEntry {
  id: string
  name: string
  /** Null when the texture could not be downloaded: the cape can still be picked. */
  texture: string | null
}

/** Everything the skin manager screen shows (`skins:getState`). */
export interface SkinState {
  username: string
  activeSkinId: string | null
  activeVariant: SkinVariant
  activeCapeId: string | null
  /** Steve, shown when the profile wears no skin; null otherwise. */
  fallbackSkin: string | null
  skins: SkinWithTexture[]
  capes: CapeEntry[]
}

/** `skins:import`: the entry, and whether that image was already in the vault. */
export interface SkinImport {
  skin: SkinWithTexture
  duplicate: boolean
}

/** What "Guardar" sends. `skinId` null keeps the current skin, `capeId` null hides the cape. */
export interface SkinSaveChoice {
  skinId: string | null
  variant: SkinVariant
  capeId: string | null
}

/** `skins:save`: the texture now worn, for the avatar. */
export interface SkinSaveResult {
  skinTexture: string | null
}
