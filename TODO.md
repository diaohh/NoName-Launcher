# TODO — NoNameLauncher

Pendientes ordenados por prioridad. Los puntos marcados con 🔍 salieron de la auditoria del 14/08/2026.

## P1 — Seguridad y robustez

- [ ] 🔍 **Cifrar los tokens en disco** — `authenticationDatabase` en `config.json` guarda el refresh token de Microsoft en claro. Usar `safeStorage.encryptString` de Electron
- [ ] 🔍 **No desloguear ante fallos transitorios** — `AuthManager.validateSelectedMicrosoftAccount` borra la cuenta si el refresh falla por cualquier motivo, incluido "sin internet". Distinguir error de red / 5xx (reintentar) de `invalid_grant` (desloguear)
- [ ] 🔍 **No exponer el accessToken de Minecraft al renderer** — `auth:login` lo devuelve y acaba en el estado de React sin que nadie lo use
- [ ] 🔍 **Endurecer la ventana OAuth** — `msftAuth.js` solo escucha `did-navigate` (falta `did-redirect-navigation`), no maneja `error=access_denied` (la ventana se queda abierta) y no restringe la navegacion a otros dominios
- [ ] 🔍 **CSP en `index.html`** y valorar `sandbox: true` (el preload no usa Node), mas `setWindowOpenHandler` en la ventana principal
- [ ] 🔍 **Reforzar `usersAllowed` en Firestore Rules** — el filtrado actual es en cliente, cualquiera con el bundle lee todos los modpacks

## P2 — Bloquean una release

- [ ] 🔍 **Falta `resources/icon.png`** — referenciado por `electron-builder.yml` y por `main/index.js`; la carpeta esta vacia
- [ ] 🔍 **`extraResources: distribution.json` apunta a un archivo inexistente** — residuo del flujo pre-Firestore, romperá el empaquetado
- [ ] 🔍 **Version unica** — conviven `package.json` 2.0.0, `launcher_version: '1.0.0'` en `LaunchManager` y "Build 0.2.1-IND" en `LoginSection`
- [ ] 🔍 **Borrar `package-lock.json`** — el lockfile valido es `pnpm-lock.yaml`

## P3 — Limpieza de codigo

- [ ] 🔍 **Errores por IPC** — `error.code` se pierde al cruzar `ipcMain.handle`; `PlayButton` compara substrings del mensaje. Devolver `{ ok, code, message }`
- [ ] **Eliminar el flujo distribution.json** — `DownloadManager.js` completo, `DistributionManager.loadDistribution/refresh/setSelectedServer/getServerInfo/requiresForge/getForgeVersion` y los canales `distro:load`, `distro:getServers`, `distro:selectServer`, `distro:getSelected` en las 4 capas
- [ ] **Eliminar componentes muertos** — `components/auth/PlayerInfo.jsx`, `components/server/ServerSelector.jsx`
- [ ] 🔍 **Eliminar funciones muertas** — `firestoreService.getLauncherConfig()`, `msftAuth.createMsftLogoutWindow()`
- [ ] 🔍 **Unificar el formato de progreso** — conviven `(current, total, msg)` y `{ type, message }` en la misma cadena de llamadas
- [ ] 🔍 **`StatusMessage` usa una variable global mutable** como bus de eventos; funciona porque solo hay una instancia montada
- [ ] 🔍 **Separar `fullMicrosoftAuthFlow`** — un flag `authMode` cambia el significado del primer parametro (auth code / access token / refresh token)
- [ ] 🔍 **`"type": "module"` en `package.json`** — elimina el warning de `postcss.config.js` en cada build
- [ ] 🔍 **Añadir ESLint** — no hay linter pese a que la indentacion ya diverge (4 espacios en managers, 2 en el resto)

## P4 — Funcionalidades faltantes

- [ ] **Boton matar juego** — `ipc.launch.kill()` existe en el backend pero no hay boton en la UI
- [ ] **Cancelar descarga/lanzamiento** — una vez se pulsa JUGAR no hay forma de cancelar (necesita `AbortController` en las descargas)
- [ ] **Errores de Firestore visibles** — `useServers` captura el error pero no lo muestra; la sidebar queda vacia sin explicacion
- [ ] **Modo offline** — sin red no se cargan los modpacks, ni siquiera para ver la lista
- [ ] **RAM en settings** — `ConfigManager` tiene `minRAM`/`maxRAM` pero la UI no los expone (el modpack ya puede sobrescribirlos desde Firestore)
- [ ] **Exportar logs** — se muestran en la UI (max 500 lineas) pero no se pueden copiar ni exportar
- [ ] **Detalles del modpack** — no se ve la lista de mods ni la version del loader
- [ ] **Barra de titulo custom** — la ventana usa el frame nativo, rompe con el diseño glassmorphism
- [ ] **Token refresh por calculo** — hoy se comprueba cada 5 min con `setInterval` y solo se desloguea; deberia programarse segun `expiresAt` y refrescar antes de expirar
- [ ] **Serializar el lanzamiento** — el main no impide dos flujos concurrentes, solo lo evita el `disabled` del boton

## P5 — Mantenimiento y evolucion

- [ ] 🔍 **Electron 37 → 43** — la 37 esta fuera de soporte; se acumulan CVEs de Chromium
- [ ] 🔍 **`firebase/firestore/lite`** — solo se usan `getDoc`/`getDocs`; el bundle del renderer son ~1.2 MB casi todos de Firebase
- [ ] 🔍 **Actualizaciones menores** — react 19.2.8, firebase 12.17, electron-builder 26.15
- [ ] **Soporte de NeoForge** — ver la nota en `CLAUDE.md`: el instalador es un fork del de Forge, el riesgo esta en el formato del id de version
- [ ] **Auto-update** (electron-updater) — no existe hoy; es lo esperable en un launcher
- [ ] **Firma de codigo en Windows** — sin ella el instalador y el portable disparan SmartScreen
