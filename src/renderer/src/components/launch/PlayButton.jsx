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

  // Only rendered with a modpack selected, by HomeScreen, which also sets `--accent`. It sits in
  // the flow of the home column rather than at a fixed offset from the bottom, and its size
  // follows the window through clamp(): at 1000x600 a fixed 18px/120px button outweighed the
  // modpack's logo, which is meant to be the biggest thing on the screen.
  return (
    <div className="shrink-0 animate-fade-in-up motion-reduce:animate-none">
      {/* One control, two halves: while a game is running the play button squares off its
          right edge so the kill button closes the pill and reads as part of it rather than as a
          second button. The glow is `--accent` at 40% through color-mix. */}
      <div className="flex items-stretch justify-center">
        <button
          className={`bg-[var(--accent)] text-white border-none py-[clamp(12px,2.2vh,18px)] px-[clamp(48px,8vw,120px)] text-[length:clamp(0.95rem,1.4vh_+_0.45rem,1.2rem)] font-black tracking-[2px] cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_color-mix(in_srgb,var(--accent)_40%,transparent)] active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none ${gameRunning ? 'rounded-l-full' : 'rounded-full'}`}
          onClick={handlePlay}
          disabled={isDisabled}
        >
          {getButtonText()}
        </button>

        <KillGameButton />
      </div>

      <p className="text-center text-white/40 text-xs mt-3 tracking-wider text-shadow-[0_1px_3px_rgb(0_0_0/0.8)]">
        {selectedServer.name}
      </p>
    </div>
  )
}
