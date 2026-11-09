/**
 * Checks on untrusted values that both processes apply by the same rule. Dependency-free, like
 * everything in `src/shared`.
 */

/**
 * A string that went through its guard. The marker is erased at compile time, so the only way
 * to hold one is the guard (or a cast, which review rejects): a function that takes a `Sha256Hex`
 * cannot be handed a value nobody checked. Kept for values that end up in a path or a URL.
 */
export type Brand<Name extends string> = string & { readonly __brand: Name }

/** A sha256 as `generate.mjs` and `crypto`'s `digest('hex')` write it: 64 lowercase hex digits. */
export type Sha256Hex = Brand<'Sha256Hex'>

/** A skin in the vault, named by the sha256 of its PNG: `skins/<id>.png`. */
export type SkinId = Brand<'SkinId'>

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * A hash from the Firestore document or the manifest becomes part of a path (the manifest
 * cache, `manifests/<hash>.json`), so anything else is refused before it gets that far.
 */
export function isSha256Hex(value: unknown): value is Sha256Hex {
  return typeof value === 'string' && SHA256_HEX.test(value)
}

/** A vault id arrives from the renderer and names a file in `skins/`. */
export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && SHA256_HEX.test(value)
}

/** A JSON object: not null, not an array. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Absent, or present and passing `check`. */
export function isOptional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value)
}

/** The string, or null when the value is not a string or is empty. */
export function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
