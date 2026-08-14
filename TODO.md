# TODO — NoNameLauncher

## Funcionalidades faltantes

- [ ] **Boton matar juego** — `ipc.launch.kill()` existe en el backend pero no hay boton en la UI. El usuario no puede cerrar Minecraft desde el launcher
- [ ] **Cancelar descarga/lanzamiento** — Una vez se clickea JUGAR, no hay forma de cancelar. Si algo tarda mucho, solo queda esperar
- [ ] **Barra de titulo custom** — La ventana usa el frame nativo de Windows (`frame: true`), rompe visualmente con el diseño glassmorphism. Otros launchers usan frameless con botones custom (minimizar, maximizar, cerrar)
- [ ] **Errores de Firestore visibles** — `useServers` captura el error pero no lo muestra al usuario. Si Firestore falla, la sidebar queda vacia sin explicacion
- [ ] **Modo offline** — Si no hay internet, no carga modpacks de Firestore. No puede ni ver la lista de servidores sin red

## Oportunidades de mejora

- [ ] **RAM en settings** — ConfigManager tiene `minRAM`/`maxRAM` (default 2G/4G) pero la UI no lo expone. Un override global seria util como fallback
- [ ] **Exportar logs** — Los logs se muestran en la UI (max 500 lineas) pero no se pueden copiar/exportar. Cuando un usuario reporta un error, no tiene forma facil de compartir el log
- [ ] **Detalles del modpack** — Al seleccionar un modpack se ve el banner y descripcion, pero no la lista de mods instalados ni la version de Forge/Fabric
- [ ] **Notificacion al terminar** — Cuando el juego arranca, no hay notificacion visual/sonora clara. Si el launcher esta minimizado el usuario no se entera
- [ ] **Token refresh por calculo** — Actualmente verifica tokens cada 5 minutos con `setInterval`. Podria calcular exactamente cuando expira y programar el refresh

## Limpieza de codigo

- [ ] **Eliminar PlayerInfo.jsx** — `components/auth/PlayerInfo.jsx` no se importa en ningun lado
- [ ] **Eliminar ServerSelector.jsx** — `components/server/ServerSelector.jsx` reemplazado por ServerSidebar
- [ ] **Eliminar distribution.json** — En la raiz del proyecto, el proyecto migro a Firestore
- [ ] **Eliminar IPC channels sin usar** — `distro:load`, `distro:getServers`, `distro:selectServer`, `distro:getSelected` eran del flujo JSON, ahora todo va por `distro:setServerData`
- [ ] **Eliminar DISTRIBUTION_URL** — En `.env`, ya no se usa como fuente principal
