import { useState } from 'react'
import { useLaunch } from '../../contexts/LaunchContext'
import { useStatus } from '../../contexts/StatusContext'
import { ipc } from '../../services/ipcClient'
import Modal from '../common/Modal'

/**
 * Sits flush against the play button while a game is running, so the pair reads as one
 * control rather than two. The game state comes from the main process, so this stays
 * correct across a renderer reload (see `launch:getStatus` in LaunchContext).
 */
export default function KillGameButton() {
  const { gameRunning } = useLaunch()
  const { showStatus } = useStatus()
  const [confirming, setConfirming] = useState(false)
  const [killing, setKilling] = useState(false)

  if (!gameRunning) return null

  const handleConfirm = async () => {
    setKilling(true)
    try {
      await ipc.launch.kill()
      // The `exit` event on launch:progress is what resets the state; closing the dialog
      // here only takes the confirmation off the screen.
      setConfirming(false)
    } catch (err) {
      showStatus(err.message || 'No se ha podido cerrar Minecraft', 'error')
    } finally {
      setKilling(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title="Cerrar Minecraft"
        aria-label="Cerrar Minecraft"
        className="bg-red-500 text-black border-none border-l border-l-black/20 py-[18px] px-6 rounded-r cursor-pointer transition-all duration-300 hover:bg-red-400 hover:shadow-[0_0_30px_rgba(239,68,68,0.4)] active:bg-red-500 flex items-center"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M4.5 4.5L13.5 13.5M13.5 4.5L4.5 13.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Cerrar Minecraft"
        size="max-w-[440px]"
        footer={
          <>
            <button
              onClick={() => setConfirming(false)}
              className="bg-white/5 border border-white/10 rounded px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={killing}
              className="bg-red-500 border-none rounded px-4 py-2 text-sm font-bold text-black hover:bg-red-400 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {killing ? 'Cerrando...' : 'Cerrar Minecraft'}
            </button>
          </>
        }
      >
        <div className="px-5 py-5">
          <p className="text-sm text-white/80">
            Se cerrara el proceso de Minecraft de inmediato.
          </p>
          <p className="text-sm text-white/50 mt-2">
            Perderas todo el progreso que no se haya guardado en la partida.
          </p>
        </div>
      </Modal>
    </>
  )
}
