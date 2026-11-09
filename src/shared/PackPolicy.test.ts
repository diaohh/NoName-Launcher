import { spawnSync } from 'child_process'
import { describe, expect, it } from 'vitest'

describe('PackPolicy', () => {
  // tools/pack-publish/generate.mjs imports this file on plain node, outside the bundle. A
  // runtime import without its `.ts` extension builds and passes every other check, and would
  // only fail the day a modpack is published. Nothing on stderr either: without
  // src/shared/package.json Node warns about the module type on every run.
  it('loads on plain node, the way the pack generator imports it', () => {
    const url = new URL('./PackPolicy.ts', import.meta.url).href
    const script = `const m = await import(${JSON.stringify(url)}); console.log(Object.keys(m).sort().join(','))`
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(run.stderr).toBe('')
    expect(run.stdout.trim()).toBe('POLICIES,compileIgnore,globToRegExp,resolvePolicy,strictRoots')
  })
})
