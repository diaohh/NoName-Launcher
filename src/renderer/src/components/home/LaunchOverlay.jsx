import { useLaunch } from '../../contexts/LaunchContext'
import ProgressBar from '../launch/ProgressBar'
import LogViewer from '../launch/LogViewer'

export default function LaunchOverlay() {
  const { launchState, gameRunning, logs } = useLaunch()

  const isActive = launchState !== 'idle' || gameRunning || logs.length > 0

  if (!isActive) return null

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 p-6 bg-gradient-to-t from-black/80 to-transparent">
      <div className="max-w-[600px] mx-auto">
        <ProgressBar />
        <LogViewer />
      </div>
    </div>
  )
}
