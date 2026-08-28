# TODO — NoNameLauncher

Pendientes ordenados por prioridad. Los puntos marcados con 🔍 salieron de la auditoria del 14/08/2026; el resto son posteriores.

## P1 — Seguridad y robustez

- [ ] 🔍 **Cifrar los tokens en disco** — `authenticationDatabase` en `config.json` guarda en claro `accessToken`, `microsoft.access_token` y `microsoft.refresh_token` (`ConfigManager.js:149-181`). Cifrarlos con `safeStorage` de Electron, que solo existe en el proceso main y exige `app.whenReady()` en Windows y Linux — ya se cumple, `ConfigManager.load()` corre dentro de `whenReady`. Tres cosas que hay que resolver antes o a la vez:
  - `load()` tiene un catch-all (`ConfigManager.js:78-82`) que **sobrescribe el config con los defaults ante cualquier excepcion**. `safeStorage.decryptString` lanza si el blob no se puede descifrar (otro usuario del SO, keyring reseteado), asi que tal cual esta borraria la cuenta en silencio. Hace falta una ruta de error real primero
  - Cifrar en disco no tapa la fuga por IPC: `config:load` devuelve el config entero con los tokens al renderer (`config.ipc.js:6-9`). Va de la mano del punto de no exponer el accessToken
  - Añadir un sello de version al fichero para poder migrar los config.json existentes (precedentes en el repo: `DistributionManager.STATE_VERSION`, `ManifestManager.SUPPORTED_FORMAT_VERSION`)
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
- [ ] **El usuario ve "undefined" cuando falla el login con Microsoft** — `AuthManager` rechaza objetos planos `{title, desc}` en vez de instancias de `Error` (`:60, :82, :101`), asi que al cruzar `ipcMain.handle` no llevan `.message` y `showStatus` pinta `undefined`. Afecta a toda la familia de fallos de autenticacion, que es la ruta de error mas comun del launcher
- [ ] **El ajuste "Directorio de datos" no tiene efecto** — `ConfigManager.getLauncherDirectory()` (`:13-30`) calcula la ruta desde `APPDATA` y **nunca lee** `settings.launcher.dataDirectory`; `getInstanceDirectory()` y `getCommonDirectory()` se construyen sobre ella. Cambiar el ajuste en la UI no mueve nada. Hacerlo funcional implica reubicar la raiz del launcher en runtime y decidir que pasa con los datos ya descargados (la UI ya avisa "Los archivos existentes no se moveran"). Un control de ajustes que miente al usuario no deberia llegar a una release

## P3 — Limpieza de codigo

- [ ] 🔍 **Errores por IPC** — `error.code` se pierde al cruzar `ipcMain.handle`; `PlayButton` compara substrings del mensaje. Devolver `{ ok, code, message }`
- [ ] 🔍 **Eliminar funciones muertas** — `msftAuth.createMsftLogoutWindow()`
- [ ] 🔍 **Unificar el formato de progreso** — conviven `(current, total, msg)` y `{ type, message }` en la misma cadena de llamadas
- [ ] **Barra de progreso atascada en "Validando archivos"** — se quedaba varios segundos en el 5%. `ProgressBar.jsx:8-11` calcula puro `current/total`, sin mapa fase→porcentaje, y cae a barra indeterminada cuando `total === 0`, asi que ademas reinicia entre fases
  - **Re-medir antes de tocar nada**: el atasco venia del MD5 por modulo sobre 342 MB, y la migracion a CDN ya cambio eso — `planSync` reporta cada 10 archivos y la via rapida de `.nnl-state.json` se salta el hashing cuando nada cambio
  - Si persiste: reportar por archivo en la rama que si hashea, y/o dar a cada fase un suelo de porcentaje para que la barra avance en vez de reiniciarse
- [ ] **Errores en ingles visibles al usuario** — los mensajes de la barra de progreso ya estan todos en español; lo que se filtra son los errores
  - `LaunchManager.js:156, 266, 423, 430, 436`; `ModLoaderManager.js:146`; `AuthManager.js:37, 52, 67, 249`; `msftAuth.js:11, 51`
  - La tabla `microsoftErrorDisplayable` entera (`AuthManager.js:259-287`), que es la que ve el usuario cuando falla el login
  - Errores de helios-core que pasan sin traducir (`MojangIndexProcessor`, `JavaGuard`), propagados por el `catch { throw err }` de `MinecraftDownloadManager.js:84-87`
- [ ] 🔍 **`StatusMessage` usa una variable global mutable** como bus de eventos; funciona porque solo hay una instancia montada
- [ ] 🔍 **Separar `fullMicrosoftAuthFlow`** — un flag `authMode` cambia el significado del primer parametro (auth code / access token / refresh token)
- [ ] 🔍 **`"type": "module"` en `package.json`** — elimina el warning de `postcss.config.js` en cada build
- [ ] 🔍 **Añadir ESLint** — no hay linter pese a que la indentacion ya diverge (4 espacios en managers, 2 en el resto)

## P4 — Funcionalidades faltantes

- [ ] **Boton matar juego** — `ipc.launch.kill()` existe en el backend pero no hay boton en la UI
- [ ] **Cancelar descarga/lanzamiento** — una vez se pulsa JUGAR no hay forma de cancelar (necesita `AbortController` en las descargas)
- [ ] **Errores de Firestore visibles** — `useServers` captura el error pero no lo muestra; la sidebar queda vacia sin explicacion
- [ ] **Modo offline** — sin red no se cargan los modpacks, ni siquiera para ver la lista
- [ ] **RAM en settings** — `ConfigManager` tiene `minRAM`/`maxRAM` pero la UI no los expone. Diseño acordado: un toggle **"Usar RAM asignada a cada modpack (Recomendado)"** activo por defecto, mas un slider en MB ligado a un input, con 4096 MB por defecto y tope la RAM del sistema
  - **Viable, sin bloqueantes**: `os.totalmem()` da la RAM del sistema. Exponerla como `systemMaxRamMB` en el `config:getSettings` que ya existe, sin canal nuevo
  - Hoy `LaunchManager.js:398-399` deja ganar **siempre** al valor del modpack (`server?.rawServer?.java?.maxRam || ConfigManager.getMaxRAM()`). El toggle necesita una preferencia nueva (`java.useModpackRam`, default `true`) y que esa linea la respete
  - El formato en disco son strings tipo `'2G'`/`'4G'`; el slider escribe `'${mb}M'`, que la JVM acepta igual. El slider gobierna `maxRAM`; `minRAM` se queda como esta
  - Canales nuevos en las 4 capas: `config:setMaxRam` y `config:setUseModpackRam`
- [ ] **Segunda barra: progreso de arranque de Minecraft** — hoy el feedback termina al hacer `spawn`, asi que el usuario se queda mirando una ventana quieta mientras la JVM arranca. Añadir una segunda barra alimentada por hitos del stdout del juego
  - **Viable, pero heuristico.** Nada parsea stdout hoy: `LaunchManager.js:528-531` reenvia los chunks tal cual. Haria falta un buffer por lineas **antes** del `.trim()` (un chunk puede partir una linea a la mitad), una tabla ordenada de hitos, un tipo de progreso nuevo con su `case` en `LaunchContext`, y un latch que se resetee junto a `this.gameProcess = null`
  - **Verificar esto primero**: en Windows se lanza `javaw.exe` (lo que devuelve `ConfigManager.getJavaExecutable()`), que **no tiene consola**. `ModLoaderManager.js:180-186` ya documenta exactamente ese problema para el instalador de Forge y lo esquiva usando `java.exe`. Antes de construir nada, comprobar empiricamente que el stdout del juego llega. Si no llega, la salida es el mismo truco, pero abre una ventana de consola junto al juego
  - Ojo tambien: `{type:'started'}` se emite hoy justo despues de `spawn`, no cuando la ventana abre. El formato de log varia por loader, version y mods, asi que la barra debe degradar a indeterminada cuando no reconozca ningun hito, nunca quedarse colgada
- [ ] **Logs en modal centrado con efecto glass** — hoy son un panel en linea de `max-h-[180px]` bajo la barra de progreso. Pasarlo a un modal centrado
  - **No existe ningun modal, portal ni manejo de Escape en el renderer**: es codigo nuevo. Reutilizar la receta de cristal de `UserProfile.jsx:46` (`bg-[rgba(20,20,22,0.95)] backdrop-blur-[20px] border border-white/10`) y el patron de click-fuera de `UserProfile.jsx:9-17`
  - **Decision de diseño pendiente**: los logs hoy se colorean por tipo (`LogViewer.jsx:4-9` — info verde, warn amarillo, error rojo, system azul). Pintarlo todo verde perderia la distincion de errores, que es justo lo que el usuario necesita ver cuando algo falla. Propuesta: verde como tono base y conservar amarillo/rojo para warn/error
- [ ] **Contador de logs "+99"** — `LogViewer.jsx:31` pinta `Mostrar Logs ({logs.length})`; a partir de 100 deberia mostrar `+99`. El buffer esta capado a 500 en `LaunchContext.jsx:16`
- [ ] **Pantalla completa por defecto** — cambiar `fullscreen: false` a `true` en `ConfigManager.getDefaultConfig()`. El argumento `--fullscreen` ya se aplica al lanzar (`LaunchManager.js:410-411`) y el toggle ya existe en `GameSection`. Solo afecta a instalaciones nuevas: `validateConfig` rellena claves **ausentes**, asi que un `config.json` existente conserva su valor, que es lo correcto — no pisar una eleccion explicita del usuario
- [ ] **Boton "Restablecer" en el directorio de datos** — junto al de "Buscar" en `LauncherSection.jsx`, habilitado solo cuando la ruta difiere de la por defecto. Requiere exponer `defaultDataDirectory` (el `ConfigManager.getLauncherDirectory()`) en `config:getSettings`, porque el renderer hoy no sabe cual es la ruta por defecto. **Depende de la entrada de P2**: sin arreglar antes que el ajuste tenga efecto, este boton restablece un valor decorativo
- [ ] **Exportar logs** — se muestran en la UI (max 500 lineas) pero no se pueden copiar ni exportar
- [ ] **Detalles del modpack** — no se ve la lista de mods ni la version del loader
- [ ] **Barra de titulo custom** — la ventana usa el frame nativo, rompe con el diseño glassmorphism
- [ ] **Token refresh por calculo** — hoy se comprueba cada 5 min con `setInterval` y solo se desloguea; deberia programarse segun `expiresAt` y refrescar antes de expirar
- [ ] **Serializar el lanzamiento** — el main no impide dos flujos concurrentes, solo lo evita el `disabled` del boton

## P5 — Mantenimiento y evolucion

- [ ] 🔍 **Electron 37 → 43** — la 37 esta fuera de soporte; se acumulan CVEs de Chromium
- [ ] 🔍 **`firebase/firestore/lite`** — solo se usan `getDoc`/`getDocs`; el bundle del renderer son ~1.2 MB casi todos de Firebase
- [ ] 🔍 **Actualizaciones menores** — react 19.2.8, firebase 12.17, electron-builder 26.15
- [ ] **Soporte de NeoForge** — su instalador es un fork del de Forge y acepta el mismo `--installClient`, asi que `ModLoaderManager.installForge` sirve tal cual; solo cambia el host del maven (`maven.neoforged.net`). El riesgo esta en el id de version, que no es uniforme: `neoforge-21.1.72` en MC 1.20.2+ pero `1.20.1-forge-47.1.106` en 1.20.1. Leerlo del `version.json` que hay dentro del jar del instalador (AdmZip ya es dependencia) en vez de componerlo con una plantilla. Requiere antes cerrar el soporte de Forge — ver "Pending" en `docs/manifest.md`
- [ ] **Auto-update** (electron-updater) — no existe hoy; es lo esperable en un launcher
- [ ] **Firma de codigo en Windows** — sin ella el instalador y el portable disparan SmartScreen
