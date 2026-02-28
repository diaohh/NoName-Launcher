import { useLaunch } from '../../contexts/LaunchContext'
import { useAuth } from '../../contexts/AuthContext'
import { useServers } from '../../contexts/ServersContext'
import { showStatus } from '../common/StatusMessage'

export default function PlayButton() {
  const { launchState, gameRunning, launch, resetState } = useLaunch()
  const { logout } = useAuth()
  const { selectedServer } = useServers()

  const isDisabled = launchState !== 'idle' && launchState !== 'error'
  const isVisible = !!selectedServer

  const handlePlay = async () => {
    try {
      await launch()
    } catch (err) {
      console.error('Launch error:', err)
      showStatus(err.message || 'Error al iniciar Minecraft', 'error')

      if (err.message && (
        err.message.includes('Session expired') ||
        err.message.includes('No account selected')
      )) {
        await logout()
        showStatus('Tu sesion ha expirado. Por favor, inicia sesion nuevamente.', 'error')
      }

      resetState()
    }
  }

  const getButtonText = () => {
    if (gameRunning) return 'JUGANDO...'
    if (launchState === 'preparing') return 'LANZANDO...'
    if (launchState === 'playing') return 'JUGANDO...'
    return 'JUGAR'
  }

  return (
    <div
      className={`absolute bottom-[120px] transition-all duration-500 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] ${
        isVisible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-[20px] pointer-events-none'
      }`}
    >
      <button
        className="bg-accent-green text-black border-none py-[18px] px-[80px] text-[1.2rem] font-black rounded tracking-[2px] cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(74,222,128,0.4)] active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none"
        onClick={handlePlay}
        disabled={isDisabled}
      >
        {getButtonText()}
      </button>

      {selectedServer && (
        <p className="text-center text-white/40 text-xs mt-3 tracking-wider">
          {selectedServer.name} — {selectedServer.minecraftVersion}
        </p>
      )}
    </div>
  )
}
