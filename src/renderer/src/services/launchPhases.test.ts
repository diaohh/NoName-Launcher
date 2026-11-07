import { describe, expect, it } from 'vitest'
import { LAUNCH_STEPS, PHASE_LABEL, PHASE_RANGE, launchStep, phasePercent } from './launchPhases'
import type { PhaseType } from '../../../shared/launchProgress'

// In declaration order, which is launch order. That every phase LaunchManager emits has a
// slice is not tested here: `PHASE_RANGE` is a `Record<PhaseType, …>` and LaunchManager
// reports through the `LaunchProgress` union, so a missing one does not compile.
const phases = Object.keys(PHASE_RANGE) as PhaseType[]

describe('launchPhases', () => {
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
