import { useServers } from '../../hooks/useServers'

export default function ServerSelector() {
  const { servers, selectedServer, selectServer, loading } = useServers()

  const handleChange = (e) => {
    selectServer(e.target.value)
  }

  return (
    <div className="my-5 p-[15px] bg-white/5 rounded-[10px]">
      <select
        className="w-full p-2.5 bg-black/30 border border-white/20 rounded text-white text-sm cursor-pointer"
        value={selectedServer?.id || ''}
        onChange={handleChange}
        disabled={loading}
      >
        {loading ? (
          <option value="" className="bg-[#333]">Cargando servidores...</option>
        ) : servers.length === 0 ? (
          <option value="" className="bg-[#333]">No hay servidores disponibles</option>
        ) : (
          servers.map(server => (
            <option key={server.id} value={server.id} className="bg-[#333]">
              {server.name}
            </option>
          ))
        )}
      </select>

      {selectedServer && (
        <div className="mt-2.5 p-2.5 bg-black/20 rounded text-xs">
          <p className="my-1"><strong>Version:</strong> {selectedServer.minecraftVersion}</p>
          <p className="my-1"><strong>Descripcion:</strong> {selectedServer.description || 'Sin descripcion'}</p>
        </div>
      )}
    </div>
  )
}
