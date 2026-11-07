import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { resolveInside } from './PathUtils'
import { ERROR_CODE } from '../../shared/errorCodes'

const base = path.join(os.tmpdir(), 'nnl-base')

function codeOf(fn) {
    try {
        fn()
    } catch (err) {
        return err.code
    }
    return null
}

describe('PathUtils.resolveInside', () => {
    it('resolves a nested relative path inside the base', () => {
        expect(resolveInside(base, 'mods/sodium.jar')).toBe(path.join(base, 'mods', 'sodium.jar'))
    })

    it.each([
        ['a parent segment', '../config.json'],
        ['a sibling that shares the prefix', '../nnl-base-evil/x.jar'],
        ['an absolute path', path.resolve(os.tmpdir(), 'elsewhere', 'x.jar')],
        ['the base itself', '.'],
        ['an empty path', '']
    ])('rejects %s', (_label, relativePath) => {
        expect(codeOf(() => resolveInside(base, relativePath))).toBe(ERROR_CODE.PATH_OUTSIDE_BASE)
    })
})
