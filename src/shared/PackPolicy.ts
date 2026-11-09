/**
 * Policy and ignore-glob resolution for pack manifests (docs/manifest.md). The one copy:
 * the launcher bundles it, and `tools/pack-publish/generate.mjs` imports this very file
 * with Node's native type stripping (Node 22.18+) when it writes a manifest.
 *
 * Plain node runs it without a build step, so it has to stay loadable that way:
 * - no runtime import (Node needs the `.ts` extension, the bundle never writes one); a type
 *   comes in with `import type`, which is erased
 * - erasable syntax only, no `enum`, `namespace` or parameter properties
 *   (`erasableSyntaxOnly` in tsconfig.node.json enforces it)
 * - no build-time global such as `__APP_VERSION__`
 *
 * `src/shared/package.json` declares this folder ESM, so Node loads it without a
 * MODULE_TYPELESS_PACKAGE_JSON warning.
 */

/** How a declared path behaves on the player's disk. See docs/manifest.md, "Policies". */
export type FilePolicy = 'strict' | 'seed' | 'additive' | 'ignore'

export interface PolicyRule {
  /** Relative to the instance, POSIX separators. */
  path: string
  policy: FilePolicy
}

export const POLICIES: readonly FilePolicy[] = ['strict', 'seed', 'additive', 'ignore']

/** Converts a glob (`**`, `*`, `?`) into an anchored RegExp. Only what `ignore` uses. */
export function globToRegExp(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i)
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

export function compileIgnore(patterns: readonly string[] | undefined): (relPath: string) => boolean {
  const regexes = (patterns || []).map(globToRegExp)
  return (relPath) => regexes.some(re => re.test(relPath))
}

/** The rule whose `path` is the longest matching prefix wins. */
export function resolvePolicy(relPath: string, rules: readonly PolicyRule[] | undefined): PolicyRule | null {
  let best: PolicyRule | null = null
  for (const rule of rules || []) {
    const rulePath = rule.path.replace(/\/+$/, '')
    if (relPath === rulePath || relPath.startsWith(`${rulePath}/`)) {
      if (!best || rulePath.length > best.path.length) {
        best = { path: rulePath, policy: rule.policy }
      }
    }
  }
  return best
}

/** Paths the launcher is allowed to delete unknown files from. */
export function strictRoots(rules: readonly PolicyRule[] | undefined): string[] {
  return (rules || [])
    .filter(rule => rule.policy === 'strict')
    .map(rule => rule.path.replace(/\/+$/, ''))
}
