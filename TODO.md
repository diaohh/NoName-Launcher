# TODO — NoNameLauncher

Pendientes ordenados por prioridad. Los puntos marcados con 🔍 salieron de la auditoria del 14/08/2026; el resto son posteriores.

## P1 — Seguridad y robustez

- [x] 🔍 **Cifrar los tokens en disco** — resuelto. `accessToken`, `microsoft.access_token` y `microsoft.refresh_token` se guardan como un unico blob `secrets` cifrado con `safeStorage`; el resto de la cuenta (username, uuid, expiraciones) sigue en claro para que `config.json` se pueda seguir inspeccionando
  - El fichero lleva ahora un sello `CONFIG_VERSION` y los `config.json` v0 se migran y se cifran en el primer `load()`
  - **Prerrequisito, tambien resuelto**: `load()` ya no sobrescribe el config con los defaults. Un JSON ilegible se mueve a `config.json.corrupt-<timestamp>` y unos secretos indescifrables solo purgan la sesion (`purgeSession`), conservando ajustes, directorio de datos y modpack seleccionado
  - La fuga por IPC era peor de lo anotado: `config:load` devolvia el config **entero** con los tres tokens y estaba expuesto en el preload, pero no en `ipcClient` — canal muerto por la regla de las 4 capas. Eliminado de las tres capas donde existia
  - Si `safeStorage.isEncryptionAvailable()` es `false` (Linux sin keyring) **no se degrada a texto plano**: la sesion vive solo en memoria y al reiniciar se vuelve al login
- [x] 🔍 **No desloguear ante fallos transitorios** — resuelto. helios-core no lanza ante un fallo de red: devuelve `responseStatus: ERROR` con el `RequestError` de got adjunto, y `AuthManager.classifyRestError` lo usa para separar `AUTH_NETWORK` (transporte, 5xx, 429) de `AUTH_INVALID_GRANT`. Solo un codigo terminal borra la cuenta; un error desconocido **tampoco** la borra. `validateSelectedMicrosoftAccount` devuelve `{ ok, code, message }` en vez de un booleano
  - Encontrado de paso y arreglado: `monitorTokenExpiration` comparaba `microsoft.expires_at`, que es la expiracion del **access token** de Microsoft (~1 h) y no la del refresh token (~90 dias), asi que el `setInterval` **deslogueaba a cualquier usuario ~24 h despues de entrar** con un refresh token perfectamente valido. Ahora reintenta el refresco y solo notifica la expiracion si falla por un motivo terminal
- [x] 🔍 **No exponer el accessToken de Minecraft al renderer** — resuelto, `auth:login` ya no lo devuelve. Nada en el renderer lo leia; `LaunchManager` lo saca de `ConfigManager` en el propio main
- [x] 🔍 **Endurecer la ventana OAuth** — resuelto: escucha `did-redirect-navigation` ademas de `did-navigate`, maneja `error=access_denied` (antes la ventana se quedaba abierta para siempre), restringe `will-navigate` a los hosts de Microsoft, deniega popups y corre con `sandbox: true`. Corregido tambien el manejador `closed`, que no distinguia un cierre del usuario de uno provocado por el exito
- [x] 🔍 **CSP y `sandbox: true`** — resuelto. La politica se aplica con `session.webRequest.onHeadersReceived` y **no** con un `<meta>` en `index.html`: el mismo documento lo sirve vite en `pnpm dev`, que necesita `ws:` y `unsafe-eval`, asi que un meta estatico obligaria a aflojarla tambien en produccion. Se marca solo el documento del launcher, nunca las paginas de Microsoft, que traen la suya. La ventana principal pasa a `sandbox: true` (el preload compila a CJS y solo usa `contextBridge`/`ipcRenderer`) y tiene `setWindowOpenHandler` mas un guard de `will-navigate`
- [ ] 🟡 **Reforzar `usersAllowed` en Firestore Rules — STAND-BY, bloqueado** — no es implementable a dia de hoy. `firebase.js` solo hace `initializeApp` + `getFirestore`: **el launcher no autentica contra Firebase**, asi que en las reglas `request.auth` es siempre `null` y no existe ninguna identidad por la que filtrar `usersAllowed`. El filtrado sigue siendo client-side y cualquiera con el bundle puede leer el catalogo completo
  - **Via A — Cloud Function + custom token.** Una Function valida el accessToken de Minecraft contra `api.minecraftservices.com/minecraft/profile` y emite un custom token de Firebase con el username como claim; el renderer hace `signInWithCustomToken` y la regla queda `allow read: if resource.data.usersAllowed.size() == 0 || request.auth.token.mcUsername in resource.data.usersAllowed`. Es la solucion real, pero exige **plan Blaze** (Spark no permite salida de red a servicios no-Google) e infraestructura nueva que mantener
  - **Via B — rediseñar el dato.** Las reglas permiten leer solo documentos con `isPublic == true` y los packs privados dejan de ser "publicos pero ocultos": pasan a no ser legibles sin identidad. Cierra la fuga sin backend, pero cambia el modelo de `usersAllowed`
  - Mientras siga en stand-by, `usersAllowed` es **solo UX** y no debe presentarse como control de acceso

## P2 — Bloquean una release

- [ ] 🔍 **Falta `resources/icon.png`** — referenciado por `electron-builder.yml` y por `main/index.js`; la carpeta esta vacia
- [ ] 🔍 **`extraResources: distribution.json` apunta a un archivo inexistente** — residuo del flujo pre-Firestore, romperá el empaquetado
- [ ] 🔍 **Version unica** — conviven `package.json` 2.0.0, `launcher_version: '1.0.0'` en `LaunchManager` y "Build 0.2.1-IND" en `LoginSection`
- [ ] 🔍 **Borrar `package-lock.json`** — el lockfile valido es `pnpm-lock.yaml`
- [x] **El usuario ve "undefined" cuando falla el login con Microsoft** — resuelto junto con el P1 de fallos transitorios: era el mismo codigo. `microsoftErrorDisplayable` devolvia objetos planos `{title, desc}`, que no sobreviven a `ipcMain.handle`; ahora es `microsoftError`, una fabrica de `Error` reales con `code` y mensaje en español. Queda pendiente en P3 quitar el prefijo `Error invoking remote method '...'` que Electron antepone
- [ ] **El ajuste "Directorio de datos" no tiene efecto** — `ConfigManager.getLauncherDirectory()` (`:13-30`) calcula la ruta desde `APPDATA` y **nunca lee** `settings.launcher.dataDirectory`; `getInstanceDirectory()` y `getCommonDirectory()` se construyen sobre ella. Cambiar el ajuste en la UI no mueve nada. Hacerlo funcional implica reubicar la raiz del launcher en runtime y decidir que pasa con los datos ya descargados (la UI ya avisa "Los archivos existentes no se moveran"). Un control de ajustes que miente al usuario no deberia llegar a una release

## P3 — Limpieza de codigo

- [ ] 🔍 **Errores por IPC** — `error.code` se pierde al cruzar `ipcMain.handle`; `PlayButton` compara substrings del mensaje. Devolver `{ ok, code, message }`
  - El P1 de auth dejo ya la mitad main del contrato hecha: `validateSelectedMicrosoftAccount` devuelve `{ ok, code, message }` y los errores de `AuthManager` llevan `code`. Lo que falta es que ese `code` sobreviva el cruce
  - **Los dos lados se tocan a la vez.** Hoy `LaunchManager` mantiene a proposito el mensaje `'Session expired. Please login again.'` **en ingles** porque `PlayButton.jsx:29-34` lo detecta por substring para forzar el `logout()` del renderer. En cuanto el `code` viaje, ese `if` pasa a comparar codigos y el mensaje se puede traducir
- [x] 🔍 **Eliminar funciones muertas** — `msftAuth.createMsftLogoutWindow()` borrada al endurecer la ventana OAuth
- [ ] 🔍 **Unificar el formato de progreso** — conviven `(current, total, msg)` y `{ type, message }` en la misma cadena de llamadas
- [ ] **Barra de progreso atascada en "Validando archivos"** — se quedaba varios segundos en el 5%. `ProgressBar.jsx:8-11` calcula puro `current/total`, sin mapa fase→porcentaje, y cae a barra indeterminada cuando `total === 0`, asi que ademas reinicia entre fases
  - **Re-medir antes de tocar nada**: el atasco venia del MD5 por modulo sobre 342 MB, y la migracion a CDN ya cambio eso — `planSync` reporta cada 10 archivos y la via rapida de `.nnl-state.json` se salta el hashing cuando nada cambio
  - Si persiste: reportar por archivo en la rama que si hashea, y/o dar a cada fase un suelo de porcentaje para que la barra avance en vez de reiniciarse
- [ ] **Errores en ingles visibles al usuario** — los mensajes de la barra de progreso ya estan todos en español; lo que se filtra son los errores
  - `AuthManager` y `msftAuth` ya estan traducidos: el P1 convirtio `microsoftErrorDisplayable` en `microsoftError` y todos sus mensajes son español
  - Quedan `LaunchManager.js` (mensajes de Java y del flujo de lanzamiento) y `ModLoaderManager.js`. La excepcion deliberada es el `'Session expired. Please login again.'` de `LaunchManager`, atado al item de errores por IPC de arriba
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
- [ ] **Migracion a TypeScript** — incremental con `allowJs`, nunca de golpe: cada paso debe ser un commit que compila y que no congela el resto del TODO. Deps: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`; `helios-core` ya trae sus `.d.ts` (`node_modules/helios-core/dist/**/*.d.ts`)
  1. `tsconfig.json` por proceso (electron-vite lo soporta) con `allowJs: true`, `checkJs` activado por carpetas a medida que se migra, y `strict: true` para todo `.ts` nuevo
  2. **Tipar primero los contratos que hoy fallan en silencio**, que es donde esta casi todo el retorno:
     - Canales IPC: un mapa `canal → (args, retorno)` hace que la regla de las 4 capas de `CLAUDE.md` (channels → handler → preload → ipcClient) la verifique el compilador en vez de la revision manual, y los canales muertos como el `config:load` que se borro en el P1 dejan de poder existir
     - El evento `launch:progress` como **union discriminada** por `type`: un `type` nuevo sin su `case` en `LaunchContext` pasa a ser un error de compilacion en vez de una UI congelada en el mensaje anterior
     - El esquema del manifest (`docs/manifest.md`) y la forma del `config.json`, incluido el sello `CONFIG_VERSION`
  3. Migrar los managers de uno en uno, main primero (no hay JSX) y de hoja a raiz: `utils/` → `ConfigManager` → `ManifestManager`/`DistributionManager` → `ModLoaderManager`/`LaunchManager` → `AuthManager`
  4. Renderer al final: contexts → hooks → components
  5. Se hace junto con la entrada de ESLint de P3 (`typescript-eslint`), que de paso cierra la divergencia de indentacion 4 vs 2 espacios en un solo barrido
- [ ] **Auto-update** (electron-updater) — no existe hoy; es lo esperable en un launcher
- [ ] **Firma de codigo en Windows** — sin ella el instalador y el portable disparan SmartScreen
