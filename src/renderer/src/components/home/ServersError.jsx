/**
 * Shown in place of the launcher wordmark when the catalogue could not be read.
 *
 * The sidebar used to just say "Sin servidores", which is indistinguishable from "you have
 * no modpacks assigned" — the one thing the player must not conclude when the real problem
 * is the network.
 */
export default function ServersError({ error, onRetry }) {
  const isNetwork = error.kind === 'network'

  return (
    <div className="flex flex-col items-center text-center max-w-[420px] px-6">
      <div className="w-12 h-12 rounded-full border border-red-500/30 bg-red-500/5 flex items-center justify-center mb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          {isNetwork ? (
            <>
              <path d="M3 3L21 21" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.8" />
              <path d="M5 12.5a10 10 0 0 1 4-2.4M15 10.1a10 10 0 0 1 4 2.4" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.8" />
              <path d="M8.5 16a5.5 5.5 0 0 1 7 0" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.8" />
              <circle cx="12" cy="19.5" r="1" fill="#ef4444" fillOpacity="0.8" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="9" stroke="#ef4444" strokeWidth="1.8" strokeOpacity="0.8" />
              <path d="M12 7.5V13" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.8" />
              <circle cx="12" cy="16.5" r="1" fill="#ef4444" fillOpacity="0.8" />
            </>
          )}
        </svg>
      </div>

      <h2 className="text-lg font-bold text-white mb-2">
        {isNetwork ? 'Sin conexion' : 'No se ha podido cargar el catalogo'}
      </h2>
      <p className="text-sm text-white/50 mb-5">{error.message}</p>

      <button
        onClick={onRetry}
        className="bg-white/5 border border-white/10 rounded px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:border-accent-green hover:text-white transition-all duration-200 cursor-pointer"
      >
        Reintentar
      </button>
    </div>
  )
}
