import { useLaunch } from '../../contexts/LaunchContext'
import { useAuth } from '../../contexts/AuthContext'
import { useServers } from '../../contexts/ServersContext'
import { useStatus } from '../../contexts/StatusContext'
import KillGameButton from './KillGameButton'
import { isTerminalAuthCode } from '../../../../shared/errorCodes'

export default function PlayButton() {
  const { launchState, gameRunning, launch, resetState } = useLaunch()
  const { logout } = useAuth()
  const { selectedServer, prepareLaunch } = useServers()
  const { showStatus } = useStatus()

  const isDisabled = launchState !== 'idle' && launchState !== 'error'
  const isVisible = !!selectedServer

  const handlePlay = async () => {
    try {
      // Re-read the modpack first: it may have gone into maintenance, or published a
      // new manifest, since the launcher was opened.
      const ready = await prepareLaunch(selectedServer.id)
      if (!ready.ok) {
        showStatus(ready.message, 'error')
        return
      }

      await launch()
    } catch (err) {
      console.error('Launch error:', err)
      showStatus(err.message || 'Error al iniciar Minecraft', 'error')

      // Only a terminal auth code means the credentials are gone for good. A network
      // failure carries a code too, and must leave the player logged in.
      if (isTerminalAuthCode(err.code)) {
        await logout()
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
      {/* One control, two halves: while a game is running the play button squares off its
          right edge so the kill button closes the pill and reads as part of it rather than as a
          second button. */}
      <div className="flex items-stretch justify-center">
        {/* The colour is the modpack's optional `accentColor` (validated in firestoreService)
            or the launcher's orange. It arrives at runtime, so it cannot be a Tailwind class —
            those are generated at build time — and goes in as a CSS variable instead; the glow
            is the same colour at 40% through color-mix, so one field drives both. */}
        <button
          style={{ '--accent': selectedServer?.accentColor ?? 'var(--color-accent-orange)' }}
          className={`bg-[var(--accent)] text-white border-none py-[18px] px-[120px] text-[1.2rem] font-black tracking-[2px] cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_color-mix(in_srgb,var(--accent)_40%,transparent)] active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none ${gameRunning ? 'rounded-l-full' : 'rounded-full'}`}
          onClick={handlePlay}
          disabled={isDisabled}
        >
          {getButtonText()}
        </button>

        <KillGameButton />
      </div>

      {selectedServer && (
        <p className="text-center text-white/40 text-xs mt-3 tracking-wider text-shadow-[0_1px_3px_rgb(0_0_0/0.8)]">
          {selectedServer.name}
        </p>
      )}
    </div>
  )
}
