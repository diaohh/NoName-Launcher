import { useServers } from '../../contexts/ServersContext'
import Spinner from '../common/Spinner'
import type { Modpack } from '../../../../shared/modpack'

interface ServerIconProps {
  server: Modpack
  isActive: boolean
  onSelect: (id: string) => void
}

function ServerIcon({ server, isActive, onSelect }: ServerIconProps) {
  const hasIcon = server.icon != null

  return (
    <button
      onClick={() => onSelect(server.id)}
      className={`
        w-[60px] h-[60px] rounded-xl border cursor-pointer
        flex items-center justify-center overflow-hidden
        transition-all duration-300
        ${isActive
          ? 'border-accent-green scale-110 bg-card-hover'
          : 'border-sidebar-border bg-white/5 hover:border-accent-green hover:scale-110 hover:bg-card-hover'
        }
      `}
      title={server.name}
    >
      {hasIcon ? (
        <img
          src={server.icon}
          alt={server.name}
          className={`w-full h-full object-cover transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-50'}`}
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <span className={`text-lg font-black uppercase transition-opacity duration-300 ${isActive ? 'text-accent-green opacity-100' : 'text-white/50'}`}>
          {server.name.charAt(0)}
        </span>
      )}
    </button>
  )
}

/** At the foot of the sidebar: re-reads the catalogue on demand, with the list kept on screen. */
function RefreshButton() {
  const { refresh, refreshing, canRefresh } = useServers()
  const label = refreshing
    ? 'Recargando modpacks...'
    : canRefresh ? 'Recargar modpacks' : 'Espera unos segundos para volver a recargar'

  return (
    <button
      onClick={refresh}
      disabled={!canRefresh}
      title={label}
      aria-label={label}
      className="mt-auto w-10 h-10 rounded-lg border border-sidebar-border bg-white/5 flex items-center justify-center text-white/50 transition-all duration-200 enabled:hover:border-accent-green enabled:hover:text-white enabled:cursor-pointer disabled:opacity-40"
    >
      {refreshing ? (
        <Spinner className="w-[18px] h-[18px]" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </g>
        </svg>
      )}
    </button>
  )
}

export default function ServerSidebar() {
  const { servers, selectedServer, selectServer, loading, error } = useServers()

  if (loading) {
    return (
      <aside className="w-[100px] h-full bg-sidebar-bg backdrop-blur-[20px] border-r border-sidebar-border flex flex-col items-center py-[30px] gap-5 z-10">
        <div className="w-[60px] h-[60px] rounded-xl bg-white/5 animate-pulse" />
        <div className="w-[60px] h-[60px] rounded-xl bg-white/5 animate-pulse" />
      </aside>
    )
  }

  return (
    <aside className="w-[100px] h-full bg-sidebar-bg backdrop-blur-[20px] border-r border-sidebar-border flex flex-col items-center py-[30px] gap-5 z-10">
      {servers.map(server => (
        <ServerIcon
          key={server.id}
          server={server}
          isActive={selectedServer?.id === server.id}
          onSelect={selectServer}
        />
      ))}

      {/* "Sin servidores" must not be the answer to a failed read: it reads as "you have no
          modpacks assigned", which is the one conclusion the player must not draw here. */}
      {error && (
        <div className="text-red-400/60 text-[10px] text-center px-2 mt-4" title={error.message}>
          {error.kind === 'network' ? 'Sin conexion' : 'Error'}
        </div>
      )}

      {!error && servers.length === 0 && (
        <div className="text-white/20 text-[10px] text-center px-2 mt-4">
          Sin servidores
        </div>
      )}

      <RefreshButton />
    </aside>
  )
}
