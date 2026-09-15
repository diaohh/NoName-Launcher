# TODO — NoNameLauncher

Pendientes ordenados por prioridad. Los puntos marcados con 🔍 salieron de la auditoria del 14/08/2026; el resto son posteriores.

## P1 — Seguridad y robustez

- [ ] 🟡 **Reforzar `usersAllowed` en Firestore Rules — STAND-BY, bloqueado** — no es implementable a dia de hoy. `firebase.js` solo hace `initializeApp` + `getFirestore`: **el launcher no autentica contra Firebase**, asi que en las reglas `request.auth` es siempre `null` y no existe ninguna identidad por la que filtrar `usersAllowed`. El filtrado sigue siendo client-side y cualquiera con el bundle puede leer el catalogo completo
  - **Via A — Cloud Function + custom token.** Una Function valida el accessToken de Minecraft contra `api.minecraftservices.com/minecraft/profile` y emite un custom token de Firebase con el username como claim; el renderer hace `signInWithCustomToken` y la regla queda `allow read: if resource.data.usersAllowed.size() == 0 || request.auth.token.mcUsername in resource.data.usersAllowed`. Es la solucion real, pero exige **plan Blaze** (Spark no permite salida de red a servicios no-Google) e infraestructura nueva que mantener
  - **Via B — rediseñar el dato.** Las reglas permiten leer solo documentos con `isPublic == true` y los packs privados dejan de ser "publicos pero ocultos": pasan a no ser legibles sin identidad. Cierra la fuga sin backend, pero cambia el modelo de `usersAllowed`
  - Mientras siga en stand-by, `usersAllowed` es **solo UX** y no debe presentarse como control de acceso

## P2 — Bloquean una release

- [ ] 🟡 **Falta `resources/icon.png` — STAND-BY** — referenciado por `electron-builder.yml` (win/linux/mac) y por `main/index.js:88`; la carpeta sigue vacia. Es **el unico bloqueante que queda para `pnpm package`**: todo lo demas del P2 esta cerrado. En espera de que se defina el icono

## P3 — Limpieza de codigo

- [ ] **Disciplina de `useEffect` — solo quedan opcionales** — la regla queda fijada en [ADR-0008](docs/adr/0008-useeffect-only-for-external-systems.md) y en `CLAUDE.md`: un efecto sincroniza con un sistema **externo** a React y nada mas, y el que se quede necesita cleanup, cancelacion, dependencias honestas y ruta de error. La auditoria del 01/09/2026 encontro 8 efectos, **ninguno del tipo anti-patron** (no hay estado derivado ni props copiadas a estado), y los cuatro que incumplian la lista estan cerrados — el ultimo, `DynamicBackground`, desaparecio al cargar el banner con un `<img>` oculto en vez de un efecto:
  - **Opcional, ya justificado**: `AuthContext` y `SettingsScreen` reimplementan cada uno su maquina loading/error, y las dos incompletas. Con `useServers` ya reescrito quedan dos llamantes, asi que un hook comun (`useIpcResource`) esta ahora mas cerca del limite de YAGNI que antes — revisar si aparece un tercero. Descartada una libreria de fetching: el renderer ya carga ~1.2 MB de Firebase y P5 lo quiere **mas pequeño**
  - De paso, `AuthContext.jsx:10` mezcla dos cosas en un efecto (carga inicial + suscripcion a `onTokenExpired`); separarlas desacopla la suscripcion del ciclo de la peticion. Y en `LaunchContext.jsx:15` el `cleanupRef` sobra: una `const` local dentro del efecto hace lo mismo

## P4 — Funcionalidades faltantes

Cada item lleva anotado lo que le falta para poder empezarse.

- [ ] **Cancelar descarga/lanzamiento** — una vez se pulsa JUGAR no hay forma de cancelar. Ni `DistributionManager.applySync` ni `downloadQueue` de helios aceptan señal de aborto, asi que es trabajo de main, no de UI: hace falta un `AbortController` que atraviese la cadena entera
- [ ] **Segunda barra: progreso de arranque de Minecraft** — hoy el feedback termina al hacer `spawn`, asi que el usuario se queda mirando una ventana quieta mientras la JVM arranca. Añadir una segunda barra alimentada por hitos del stdout del juego
  - **El bloqueante que tenia ya esta resuelto.** El item pedia comprobar si `javaw.exe`, que no tiene consola, entrega stdout. Medido el 01/09/2026 con `child_process.spawn` y stdio `pipe`: `javaw.exe` y `java.exe` devuelven **exactamente los mismos 5575 bytes** por stdout con `--help`. El problema de `javaw` es la asignacion de consola cuando el stdio se **hereda**, no los pipes. **No hace falta** el truco de `ModLoaderManager._consoleJavaExec` ni abrir una consola junto al juego
  - Lo que sigue siendo trabajo: un buffer por lineas **antes** del `.trim()` (`LaunchManager.js` reenvia los chunks tal cual y un chunk puede partir una linea a la mitad), una tabla ordenada de hitos, un tipo de progreso nuevo con su `case` en `LaunchContext` y su tramo en `launchPhases.js`, y un latch que se resetee junto a `this.gameProcess = null`
  - Sigue siendo **heuristico**: el formato de log varia por loader, version y mods, asi que la barra debe degradar a indeterminada cuando no reconozca ningun hito, nunca quedarse colgada. La tabla solo se calibra de verdad lanzando un modpack real. Ojo tambien: `{type:'started'}` se emite justo despues de `spawn`, no cuando la ventana abre
- [ ] **Exportar logs** — se muestran en la UI (max 500 lineas) pero no se pueden copiar ni exportar. Con el modal ya montado, el sitio natural es un boton en su cabecera
- [ ] **Detalles del modpack** — no se ve la lista de mods ni la version del loader. **Falta definicion** de que se enseña y donde; el dato existe en el manifest, que ya se descarga y se cachea en `manifests/<sha256>.json`
- [ ] **Barra de titulo custom** — la ventana usa el frame nativo, rompe con el diseño glassmorphism. Los tres canales (`window:minimize/maximize/close`) ya existen en las 4 capas y `registerWindowIPC` ya hace el toggle de maximizar; falta `frame: false`, el componente con `-webkit-app-region: drag` y ajustar el alto de las tres pantallas, que hoy son todas `h-screen`. El boton maximizar/restaurar necesita ademas conocer el estado para cambiar de icono

## P5 — Mantenimiento y evolucion

- [ ] 🔍 **Electron 37 → 43** — la 37 esta fuera de soporte; se acumulan CVEs de Chromium
- [ ] 🔍 **`firebase/firestore/lite`** — solo se usan `getDoc`/`getDocs`; el bundle del renderer son ~1.2 MB casi todos de Firebase
- [ ] 🔍 **Actualizaciones menores** — react 19.2.8, firebase 12.17, electron-builder 26.15
- [ ] **Soporte de NeoForge** — su instalador es un fork del de Forge y acepta el mismo `--installClient`, asi que `ModLoaderManager.installForge` sirve tal cual; solo cambia el host del maven (`maven.neoforged.net`). El riesgo esta en el id de version, que no es uniforme: `neoforge-21.1.72` en MC 1.20.2+ pero `1.20.1-forge-47.1.106` en 1.20.1. Leerlo del `version.json` que hay dentro del jar del instalador (AdmZip ya es dependencia) en vez de componerlo con una plantilla. Requiere antes cerrar el soporte de Forge — ver "Pending" en `docs/manifest.md`
- [ ] **`"type": "module"` / migracion a ESM** — su unico objetivo inmediato (el warning de postcss) ya se cerro renombrando el fichero a `.mjs`, asi que lo que queda es la migracion de verdad, y no es barata: el preload **sigue obligatoriamente en CJS** porque la ventana corre con `sandbox: true` ([ADR-0010](docs/adr/0010-sandboxed-windows-and-a-webrequest-csp.md)), el main pasa a `.mjs` y hay que sustituir `__dirname` por `import.meta`, y reapuntar el campo `main` de `package.json`. Se prueba con `pnpm package`, no con `pnpm dev`. Va con la migracion a TypeScript, que revisa la salida de build igualmente
- [ ] **Migracion a TypeScript** — incremental con `allowJs`, nunca de golpe: cada paso debe ser un commit que compila y que no congela el resto del TODO. Deps: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`; `helios-core` ya trae sus `.d.ts` (`node_modules/helios-core/dist/**/*.d.ts`)
  1. `tsconfig.json` por proceso (electron-vite lo soporta) con `allowJs: true`, `checkJs` activado por carpetas a medida que se migra, y `strict: true` para todo `.ts` nuevo
  2. **Tipar primero los contratos que hoy fallan en silencio**, que es donde esta casi todo el retorno:
     - Canales IPC: un mapa `canal → (args, retorno)` hace que la regla de las 4 capas de `CLAUDE.md` (channels → handler → preload → ipcClient) la verifique el compilador en vez de la revision manual, y los canales muertos como el `config:load` que se borro en el P1 dejan de poder existir
     - El evento `launch:progress` como **union discriminada** por `type`: un `type` nuevo sin su `case` en `LaunchContext` pasa a ser un error de compilacion en vez de una UI congelada en el mensaje anterior
     - El esquema del manifest (`docs/manifest.md`) y la forma del `config.json`, incluido el sello `CONFIG_VERSION`
  3. Migrar los managers de uno en uno, main primero (no hay JSX) y de hoja a raiz: `utils/` → `ConfigManager` → `ManifestManager`/`DistributionManager` → `ModLoaderManager`/`LaunchManager` → `AuthManager`
  4. Renderer al final: contexts → hooks → components
  5. Se hace junto con la entrada de `typescript-eslint`, que es el barrido en el que se unifica la indentacion 4 vs 2 espacios — el momento que [ADR-0011](docs/adr/0011-enforce-indentation-per-area.md) deja fijado para hacerlo
- [ ] **Auto-update** (electron-updater) — no existe hoy; es lo esperable en un launcher
- [ ] **Firma de codigo en Windows** — sin ella el instalador y el portable disparan SmartScreen
