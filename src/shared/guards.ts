/**
 * Checks on untrusted values that both processes apply by the same rule. Dependency-free, like
 * everything in `src/shared`.
 */

/** A sha256 as `generate.mjs` and `crypto`'s `digest('hex')` write it: 64 lowercase hex digits. */
const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * A hash from the Firestore document or the manifest becomes part of a path (the manifest
 * cache, `manifests/<hash>.json`), so anything else is refused before it gets that far.
 */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value)
}
