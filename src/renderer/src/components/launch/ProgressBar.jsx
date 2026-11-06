import { useLaunch } from '../../contexts/LaunchContext'
import { PHASE_LABEL, STARTUP_LABEL } from '../../services/launchPhases'

/**
 * One labelled bar. A null `percent` is an indeterminate pulse: the honest answer while
 * nothing countable has arrived yet.
 */
function Bar({ label, percent, message }) {
  return (
    <div className="my-3">
      <div className="flex justify-between text-xs text-white/60 mb-1.5">
        <span>{label}</span>
        <span>{percent != null ? `${percent}%` : ''}</span>
      </div>
      <div className="w-full h-[6px] bg-white/10 rounded-full overflow-hidden">
        {percent != null ? (
          <div
            className="h-full bg-accent-green rounded-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-accent-green/60 rounded-full animate-pulse" />
        )}
      </div>
      <p className="text-xs text-white/40 mt-1.5">{message}</p>
    </div>
  )
}

/**
 * The preparation bar, and under it, once the JVM is up, a second one that follows the game
 * to its title screen. Both go away when the startup is over: the game window is what the
 * player is looking at by then.
 */
export default function ProgressBar() {
  const { launchState, progress, startup } = useLaunch()

  if (launchState === 'idle') return null

  // Playing with no startup to follow: it finished, or a reload found the game already up.
  if (launchState === 'playing' && (!startup || startup.done)) return null

  return (
    <>
      {/* `percent` is the position across the whole preparation, worked out from the phase map
          in services/launchPhases. It is null only until the first recognised phase arrives. */}
      <Bar
        label={PHASE_LABEL[progress.phase] ?? (progress.phase || 'Preparando...')}
        percent={progress.percent}
        message={progress.message || 'Iniciando...'}
      />

      {launchState === 'playing' && (
        <Bar label={STARTUP_LABEL} percent={startup.percent} message={startup.message} />
      )}
    </>
  )
}
