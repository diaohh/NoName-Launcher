import { useEffect, useState } from 'react'
import { ipc } from '../../services/ipcClient'
import Modal from './Modal'

/**
 * Asks before the launcher closes in the middle of preparing a launch (ADR-0013).
 *
 * Main holds the close only while a launch is being prepared and sends `closeRequested`; with
 * a game already running it closes straight away, because the game was spawned detached and
 * keeps running on its own. Interrupting a preparation loses nothing that the next launch
 * does not redo: every file is checked against its hash before it is used.
 */
export default function CloseGuard() {
  const [asking, setAsking] = useState(false)

  // IPC subscription; the function onCloseRequested hands back is the cleanup.
  useEffect(() => ipc.window.onCloseRequested(() => setAsking(true)), [])

  return (
    <Modal
      open={asking}
      onClose={() => setAsking(false)}
      title="Salir del launcher"
      size="max-w-[440px]"
      footer={
        <>
          <button
            onClick={() => setAsking(false)}
            className="bg-white/5 border border-white/10 rounded px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 cursor-pointer"
          >
            Seguir aqui
          </button>
          <button
            onClick={ipc.window.confirmClose}
            className="bg-accent-wine border-none rounded px-4 py-2 text-sm font-bold text-white hover:bg-[#93264a] transition-all duration-200 cursor-pointer"
          >
            Salir
          </button>
        </>
      }
    >
      <div className="px-5 py-5">
        <p className="text-sm text-white/80">
          Minecraft se esta preparando. Si sales ahora, la descarga se interrumpira.
        </p>
        <p className="text-sm text-white/50 mt-2">
          Lo que falte se descargara la proxima vez que pulses JUGAR.
        </p>
      </div>
    </Modal>
  )
}
