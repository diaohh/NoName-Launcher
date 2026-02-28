import { useLaunch } from '../../contexts/LaunchContext'

export default function ProgressBar() {
  const { launchState, progress } = useLaunch()

  if (launchState === 'idle') return null

  const hasProgress = progress.total > 0 && progress.current >= 0
  const percent = hasProgress
    ? Math.min(100, Math.floor((progress.current / progress.total) * 100))
    : 0

  return (
    <div className="my-3">
      <div className="flex justify-between text-xs text-white/60 mb-1.5">
        <span>{progress.phase || 'Preparando...'}</span>
        <span>{hasProgress && percent > 0 ? `${percent}%` : ''}</span>
      </div>
      <div className="w-full h-[6px] bg-white/10 rounded-full overflow-hidden">
        {hasProgress ? (
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
