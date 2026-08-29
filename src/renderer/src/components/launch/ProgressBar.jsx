import { useLaunch } from '../../contexts/LaunchContext'

export default function ProgressBar() {
  const { launchState, progress } = useLaunch()

  if (launchState === 'idle') return null

  // `percent` is the position across the whole launch, worked out from the phase map in
  // services/launchPhases. It is null only until the first recognised phase arrives,
  // which is the one moment an indeterminate bar is the honest answer.
  const percent = progress.percent

  return (
    <div className="my-3">
      <div className="flex justify-between text-xs text-white/60 mb-1.5">
        <span>{progress.phase || 'Preparando...'}</span>
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
      <p className="text-xs text-white/40 mt-1.5">{progress.message || 'Iniciando...'}</p>
    </div>
  )
}
