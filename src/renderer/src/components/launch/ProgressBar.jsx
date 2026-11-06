import { useLaunch } from '../../contexts/LaunchContext'
import { LAUNCH_STEPS, PHASE_LABEL, STARTUP_LABEL, launchStep } from '../../services/launchPhases'

/** The point closing a step: checked once the launch is past it. */
function StepPoint({ state }) {
  if (state === 'done') {
    return (
      <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--accent)] flex items-center justify-center">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.2L4.2 7.4L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }

  return (
    <span className={`shrink-0 w-4 h-4 rounded-full border-2 ${state === 'active' ? 'border-[var(--accent)]' : 'border-white/20'}`} />
  )
}

/**
 * The stretch of bar leading to a point. A null `fill` is an indeterminate pulse: the honest
 * answer while nothing countable has arrived yet.
 */
function Stretch({ fill }) {
  return (
    <div className="flex-1 h-[5px] bg-white/10 rounded-full overflow-hidden">
      {fill != null ? (
        <div className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-300" style={{ width: `${fill}%` }} />
      ) : (
        <div className="h-full w-1/3 bg-[var(--accent)] opacity-60 rounded-full animate-pulse" />
      )}
    </div>
  )
}

/**
 * One bar for the whole launch, split into the steps of LAUNCH_STEPS: the stretch of the step
 * in progress fills from 0 to 100, and the ones behind it are full and checked. The last step
 * follows the game from the JVM to its title screen; once that is over the tracker goes away,
 * because the game window is what the player is looking at by then.
 *
 * The colour is `--accent`, set by HomeScreen from the modpack, the same one JUGAR uses.
 */
export default function ProgressBar() {
  const { launchState, progress, startup } = useLaunch()

  if (launchState === 'idle') return null

  const starting = launchState === 'playing'

  // Playing with no startup to follow: it finished, or a reload found the game already up.
  if (starting && (!startup || startup.done)) return null

  const step = starting
    ? { index: LAUNCH_STEPS.length - 1, percent: startup.percent }
    : launchStep(progress.type, progress.percent)

  const label = starting
    ? STARTUP_LABEL
    : PHASE_LABEL[progress.phase] ?? (progress.phase || 'Preparando...')
  const message = starting ? startup.message : (progress.message || 'Iniciando...')

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={step.percent ?? undefined}
      className="w-full rounded-xl bg-black/35 backdrop-blur-md border border-white/10 px-4 py-3"
    >
      <div className="flex justify-between gap-3 text-xs text-white/70 mb-2.5">
        <span className="truncate">{label}</span>
        <span className="shrink-0">{step.percent != null ? `${step.percent}%` : ''}</span>
      </div>

      <ol className="flex gap-1.5">
        {LAUNCH_STEPS.map((s, i) => {
          const state = i < step.index ? 'done' : i === step.index ? 'active' : 'pending'
          const fill = state === 'done' ? 100 : state === 'active' ? step.percent : 0

          return (
            <li key={s.label} className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Stretch fill={fill} />
                <StepPoint state={state} />
              </div>
              <span className={`text-[11px] text-center pr-5 truncate ${state === 'pending' ? 'text-white/30' : 'text-white/70'}`}>
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="text-xs text-white/40 mt-1.5 truncate">{message}</p>
    </div>
  )
}
