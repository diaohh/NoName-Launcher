import { describe, expect, it } from 'vitest'
import { LAUNCH_STEPS, PHASE_LABEL, PHASE_RANGE, launchStep, phasePercent } from './launchPhases'
import type { PhaseType } from '../../../shared/launchProgress'

/** Types that are not preparation phases and so have no slice, by design (ADR-0005). */
const NOT_A_PHASE = new Set(['started', 'exit', 'error', 'game_startup', 'stdout', 'stderr'])

// In declaration order, which is launch order.
const phases = Object.keys(PHASE_RANGE) as PhaseType[]

/**
 * The `type` literals LaunchManager emits, read from its source. `PHASE_RANGE` is a
 * `Record<PhaseType, …>` now, but LaunchManager is still JavaScript and nothing checks what it
 * emits against the union; until it is converted (TODO-Migracion.md, Fase 5), this is the check.
 *
 * Read through vite's glob import rather than `fs`, so the renderer's tsconfig needs no node
 * types, and with either extension, so the check survives LaunchManager moving to `.ts`.
 */
function emittedTypes(): Set<string> {
  const sources = import.meta.glob<string>('../../../main/managers/LaunchManager.{js,ts}', { query: '?raw', import: 'default', eager: true })
  const text = Object.values(sources).join('\n')
  return new Set([...text.matchAll(/(?:^|[\s{,])type: '([a-z_]+)'/gm)].map(match => match[1]))
}

describe('launchPhases', () => {
  it('gives every phase LaunchManager emits a slice of the bar', () => {
    const types = emittedTypes()
    expect(types.size).toBeGreaterThan(0)

    for (const type of types) {
      if (NOT_A_PHASE.has(type)) continue
      expect(PHASE_RANGE, `phase "${type}" has no slice in PHASE_RANGE`).toHaveProperty(type)
    }
  })

  it('labels exactly the phases that have a slice', () => {
    expect(Object.keys(PHASE_LABEL).sort()).toEqual([...phases].sort())
  })

  it('covers 0-100 with contiguous slices, in launch order', () => {
    expect(PHASE_RANGE[phases[0]][0]).toBe(0)
    expect(PHASE_RANGE[phases[phases.length - 1]][1]).toBe(100)

    for (let i = 1; i < phases.length; i++) {
      expect(PHASE_RANGE[phases[i]][0], phases[i]).toBe(PHASE_RANGE[phases[i - 1]][1])
    }
  })

  it('cuts the steps on phase boundaries', () => {
    const boundaries = new Set(phases.flatMap(type => PHASE_RANGE[type]))

    for (const step of LAUNCH_STEPS) {
      if (step.until == null) continue
      expect(boundaries.has(step.until), step.label).toBe(true)
    }
  })

  it('never moves the tracker backwards through a launch', () => {
    let previous = { index: 0, percent: 0 }

    for (const type of phases) {
      for (let current = 0; current <= 4; current++) {
        const step = launchStep(type, phasePercent(type, current, 4))
        const percent = step.percent ?? 0
        const movedBack = step.index < previous.index
          || (step.index === previous.index && percent < previous.percent)

        expect(movedBack, `${type} ${current}/4`).toBe(false)
        previous = { index: step.index, percent }
      }
    }
  })
})
