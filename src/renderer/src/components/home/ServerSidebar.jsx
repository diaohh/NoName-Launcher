import { useServers } from '../../contexts/ServersContext'

function ServerIcon({ server, isActive, onSelect }) {
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

export default function ServerSidebar() {
  const { servers, selectedServer, selectServer, loading } = useServers()

  if (loading) {
    return (
      <aside className="w-[100px] h-screen bg-sidebar-bg backdrop-blur-[20px] border-r border-sidebar-border flex flex-col items-center py-[30px] gap-5 z-10">
        <div className="w-[60px] h-[60px] rounded-xl bg-white/5 animate-pulse" />
        <div className="w-[60px] h-[60px] rounded-xl bg-white/5 animate-pulse" />
      </aside>
    )
  }

  return (
    <aside className="w-[100px] h-screen bg-sidebar-bg backdrop-blur-[20px] border-r border-sidebar-border flex flex-col items-center py-[30px] gap-5 z-10">
      {servers.map(server => (
        <ServerIcon
          key={server.id}
          server={server}
          isActive={selectedServer?.id === server.id}
          onSelect={selectServer}
        />
      ))}

      {servers.length === 0 && (
        <div className="text-white/20 text-[10px] text-center px-2 mt-4">
          Sin servidores
        </div>
      )}
    </aside>
  )
}
