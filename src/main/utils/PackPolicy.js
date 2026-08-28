/**
 * Policy and ignore-glob resolution for pack manifests.
 *
 * This mirrors the same logic in `tools/pack-publish/generate.mjs`, which cannot be
 * imported here: the tool runs on plain node while these sources are bundled with
 * extensionless imports. Any change to matching rules must be applied to both.
 * See docs/manifest.md.
 */

export const POLICIES = ['strict', 'seed', 'additive', 'ignore']

/** Converts a glob (`**`, `*`, `?`) into an anchored RegExp. Only what `ignore` uses. */
export function globToRegExp(pattern) {
    let re = ''
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i]
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

export function compileIgnore(patterns) {
    const regexes = (patterns || []).map(globToRegExp)
    return (relPath) => regexes.some(re => re.test(relPath))
}

/** The rule whose `path` is the longest matching prefix wins. */
export function resolvePolicy(relPath, rules) {
    let best = null
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
export function strictRoots(rules) {
    return (rules || [])
        .filter(rule => rule.policy === 'strict')
        .map(rule => rule.path.replace(/\/+$/, ''))
}
