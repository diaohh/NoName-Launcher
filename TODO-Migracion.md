# TODO-Migracion — TypeScript

Documento **temporal**: lleva el progreso de la migracion a TypeScript y de los pasos previos que
la preparan. Se borra cuando la Fase 8 este cerrada; lo que tenga que sobrevivir (decisiones,
reglas) se habra pasado antes a un ADR, a `AGENTS.md` o a `TODO.md`.

## Reglas de este documento

- **Se marca, no se borra.** Un item terminado pasa a `- [x]` y se le añade al final la fecha
  (`dd/mm/aaaa`) y el commit o PR que lo cerro. Un item descartado se marca `- [~]` con el motivo.
- **Cada fase tiene su checklist de documentacion.** Una fase no esta cerrada hasta que
  `AGENTS.md`, `TODO.md`, el README o el ADR que le toque reflejan el estado real.
- **Criterio de "hecho" para cualquier commit de la migracion**: `pnpm lint` a 0 errores,
  `pnpm typecheck` a 0 errores (desde la Fase 3), `pnpm test` en verde (desde la Fase 2) y
  `pnpm build` compila. Se comprueba **antes de cada commit**, no tras cada cambio. Las fases que
  tocan Electron o el lanzamiento se validan ademas a mano (ver la checklist de humo de la Fase 1).
- **Nada se commitea sin revision del usuario**, igual que el resto del repo. Estilo de commit el
  de siempre (`AGENTS.md` → Commits). Este archivo **se versiona**: las casillas se marcan en el
  mismo commit que cierra el item.

## Ramas

- **`migration`** es la rama de integracion, creada desde `main` el 06/11/2026. Cada fase (o
  parte de una fase) se trabaja en su propia rama sacada de `migration` y entra por **PR contra
  `migration`**, nunca contra `main`.
- Nombre de las ramas de fase: `ts/f<N>-<tema>` (p. ej. `ts/f1-electron`, `ts/f2-vitest`). No
  pueden llamarse `migration/…`: git no admite a la vez una rama `migration` y otra que cuelgue
  de ella.
- `main` queda para arreglos urgentes. Lo que entre en `main` se trae a `migration` con un
  **merge** (no rebase, que reescribiria lo ya integrado por PR), cuanto antes mejor: los
  renombrados `.js → .ts` hacen que los conflictos crezcan con el tiempo.
- Cuando `migration` este estable (Fase 7), un PR `migration → main` y la release.
- **Un cambio logico por commit.** Convertir un archivo a TS no lleva refactors dentro: si un
  archivo pide partirse (p. ej. `LaunchManager`, 1.028 lineas), se hace en un commit aparte,
  antes o despues.

## Contexto (06/11/2026)

- **Tamaño**: ~8.800 lineas en `src/` — main 4.989, renderer 3.575, preload 74, shared 177. La
  estimacion del 17/09/2026 (5–8 dias) se hizo sobre ~4.700; extrapolando, **9–14 dias
  efectivos**. Es una extrapolacion, se corrige al cerrar la Fase 4 con datos reales.
- **Reestimacion (07/11/2026, al cerrar las Fases 4 y 5)**: las dos se hicieron juntas en una
  sesion, muy por debajo de la extrapolacion. Tipar fue lo de menos; el tiempo se fue en los
  guardas de los datos externos y en el mapa de handlers. Tras ellas: main 5.846 lineas (crece
  con los tipos y los guardas), shared 686 (contratos), preload 91. Queda el renderer, 3.642
  lineas en 41 archivos, casi todo JSX con props sencillas, y el cierre: **3–5 dias efectivos**.
  El cuello de botella ya no es el tipado sino las pruebas de humo manuales de cada fase.
- **Node local 22.22** (el TODO decia 20.19): el type-stripping nativo ya esta disponible aqui,
  lo que desbloquea quitar la duplicacion de `PackPolicy` (Fase 8).
- **Por que este orden**: Electron va primero para no mezclar sus regresiones con las de la
  migracion, y los tests van antes de tocar archivos porque son lo que dice si la migracion
  rompio algo. Los contratos compartidos van antes que los managers porque ahi esta casi todo el
  retorno: son lo que hoy falla en silencio.
- **Decisiones del usuario (06/11/2026)**: se conserva la indentacion por zonas de ADR-0011 (no
  hay reformateo), este archivo se versiona, los tests van junto al fuente y con cobertura
  **minima**, solo en lo que falla en silencio.
- **Fuera de alcance** (siguen en `TODO.md`, no bloquean ni son bloqueados): B1 publicacion
  atomica, `usersAllowed`, P4 entero, firma de codigo, auto-update, NeoForge, ESM, B16 y PKCE
  completo.

---

## Fase 0 — Arreglos rapidos (no bloquean la migracion)

Independientes entre si y de lo demas; pueden ir antes o intercalados.

- [x] `firebase/firestore/lite`: cambiar `getFirestore` en `services/firebase.js` y los imports
  de `services/firestoreService.js`. Comprobar que solo se usan `doc`/`collection`/`getDoc`/
  `getDocs` (y lo que haya de query) y medir el bundle del renderer antes y despues —
  06/11/2026, `ts/f0-quick-wins`. Chunk inicial 1.235,90 → 911,82 kB. Probado contra el
  Firestore real (lista + documento). La carrera de 12 s se queda: lite no tiene plazo propio, y
  un fallo de red llega como `unknown`, que `useServers` ahora cuenta como "sin red"
- [x] S7, parte barata: `partition` propia para la ventana de login (`windows/msftAuth.js`) y
  limpiar su sesion al cerrar sesion en `AuthManager` — 06/11/2026, `ts/f0-quick-wins`.
  Particion en memoria (`msft-auth`), vaciada en el handler de logout (`auth.ipc.js`, no en
  `AuthManager`, que no conoce ventanas), y `purgeLegacyAuthCookies` al arrancar borra las
  cookies de Microsoft que dejaron versiones anteriores en la sesion por defecto. Comprobado
  con un script en Electron: solo se borran las de Microsoft, la particion no persiste y queda
  vacia tras el logout. Login, logout y nuevo login probados a mano por el usuario el 06/11/2026
- [x] S9: addendum fechado en ADR-0007 (el `accessToken` viaja en la linea de comandos del juego)
  — 06/11/2026: ya estaba hecho, en el addendum del 17/09/2026 de ADR-0007. Solo se quita el
  item de `TODO.md`

**Documentacion**
- [x] `TODO.md`: marcar los items de P5 correspondientes y quitar `firestore/lite` de la lista —
  06/11/2026, `firestore/lite` y S9 cerrados, S7 reducido a PKCE
- [x] `AGENTS.md`: la nota de Gotchas sobre el bundle de Firebase y la de ADR-0007 si cambia algo
  — 06/11/2026: Gotchas reescrito para `firestore/lite`, regla de la particion de login en
  "Authentication". ADR-0009 recibe un addendum (la carrera de 12 s sigue haciendo falta)

---

## Fase 1 — Electron 37 → 45 y actualizaciones de dependencias

En una rama propia, **antes** de cualquier `.ts`. Un commit por salto relevante, para poder
bisecar. Rama `ts/f1-electron`.

- [x] Leer los breaking changes de Electron 38→44 y anotar aqui los que tocan APIs que usamos:
  `safeStorage`, `powerMonitor`, `session.webRequest` (CSP, ADR-0010), `sandbox`, ventana sin
  marco, `requestSingleInstanceLock`, `shell.trashItem`, `dialog`, `BrowserWindow` del login —
  06/11/2026, leidos hasta la 45 (`docs/breaking-changes.md` de electron/electron). Nos tocan:
  - **45: `safeStorage` sincrono deprecado, eliminado en 46.** Sigue funcionando en 45 (avisa
    por consola). Pasa a item propio, despues de la Fase 2 — ver "Fase 2b"
  - **42: el binario ya no se descarga en `postinstall`**, sino en el primer uso; electron-vite
    lee `path.txt` y falla ("Electron uninstall") si no esta. `pnpm dev`/`preview` ejecutan
    antes `install-electron`, y `electron` sale de `onlyBuiltDependencies`
  - **43: los dialogos sin `defaultPath` abren en Descargas.** El selector del directorio de
    datos ahora empieza en el directorio actual; Java manual e importar skin se quedan en
    Descargas (sin punto de partida obvio, y las skins suelen estar ahi)
  - Sin impacto: `clipboard` fuera del renderer (44; usamos `navigator.clipboard`), shims de
    Node fuera del preload sandboxed (45; el preload no los usa), fin de Windows 32 bits (44;
    no lo generamos), descriptores de ficheros del ASAR (45), `clearStorageData` sin `quotas`
- [x] `electron` 37.1.0 → ~~44.x~~ **45.2.3** — 06/11/2026, `b16e8af`. La 45 ya era estable
  (21/10/2026) y se mantiene mas tiempo que la 44. Junto con electron-vite 5 → 6
- [x] `electron-builder` a la ultima 26.x (arrastra la mayoria de avisos de tar/minimatch/xmldom)
  — 06/11/2026, `a472c50`, 26.18.0. Reinstalado para que `app-builder-lib` 26.8.1 no se quedara
  colgado del lockfile
- [x] `vite` 6 → 8 y `@vitejs/plugin-react` 4 → 6 — **comprobar antes los `peerDependencies`
  de `electron-vite`**; si su version actual no soporta vite 8, subir a la mayor que soporte (o
  subir electron-vite) y anotarlo — 06/11/2026, `2617a54`. electron-vite 5 solo llegaba a vite 7;
  la 6 admite 6–8. De paso, `9fcdbe1` arregla la entrada del renderer: el escaneo de
  dependencias en dev fallaba (ya con vite 6) y cargaba React dos veces ("Invalid hook call")
- [x] Menores: `react`/`react-dom`, `firebase`, `postcss`, `tailwindcss` — 06/11/2026,
  `a472c50`: React 19.3.1, **Firebase 13.2** (la mayor solo rompe AI Logic; probado contra el
  Firestore real), PostCSS 8.5.32, Tailwind 4.3.5. El chunk inicial pasa de 892 a 1.003 kB: lite
  incluye ahora los tipos BSON y vectoriales (12.19 ya daba 968 kB)
- [x] `pnpm audit --prod` sigue a 0; anotar el total de `pnpm audit` antes y despues —
  06/11/2026: 172 avisos (3 criticos) → 41 (2 criticos, `protobufjs` y `websocket-driver`, que
  vienen del SDK completo de Firestore instalado como dependencia de `firebase` y no entran en
  el bundle). `--prod` a 0
- [x] Prueba de humo manual en `pnpm dev` **y** en el instalador de `pnpm package`
  (`pnpm dev` arranca, descifra la sesion guardada por Electron 37 y valida el token;
  `pnpm package` genera instalador y portable con Electron 45.2.3) — 07/11/2026, validada a
  mano por el usuario sobre `migration` (`d08dd65`, PR #10):
  - [x] login Microsoft, reinicio del launcher con la sesion guardada (`safeStorage`)
  - [x] lanzar un modpack Fabric de punta a punta, ver logs, matar el juego
  - [x] cerrar el launcher con el juego abierto (el juego sobrevive, ADR-0013) y durante la
        preparacion (confirmacion de `CloseGuard`)
  - [x] segunda instancia enfoca la primera
  - [x] gestor de skins: importar, guardar skin/capa, borrar a la papelera
  - [x] ajustes: RAM, Java manual, directorio de datos (el selector abre en el actual)

**Documentacion**
- [x] `AGENTS.md`: "Electron 37" en la cabecera del proyecto y cualquier gotcha nuevo —
  06/11/2026: cabecera, `onlyBuiltDependencies`/`install-electron`, `safeStorage` sincrono hasta
  la 46, tamaño del chunk, y Gotchas de la entrada del renderer, los dialogos y el preload
- [x] `README.md`: versiones si aparecen — 06/11/2026: Tech Stack y la nota de instalacion
- [x] `TODO.md`: cerrar "Electron 37 → 44" y "Actualizaciones menores" — 06/11/2026
- [x] ADR-0007: addendum sobre la API asincrona de `safeStorage` — 06/11/2026

---

## Fase 2 — Vitest y tests de caracterizacion (sobre el JS actual)

Los tests se escriben **contra el comportamiento actual**, sin cambiar codigo. Son la red de
seguridad de las Fases 4–7: un archivo convertido a TS tiene que pasar los mismos tests.

- [x] Añadir `vitest` (devDependency) y el script `pnpm test` — 07/11/2026,
  `2d8a21c`. Vitest 5.1 (admite vite 6–8); tambien `pnpm test:watch`
- [x] `vitest.config.mjs` propio: la config de electron-vite es multi-objetivo y no se puede
  reutilizar tal cual. Alias de `electron` a un stub de pruebas (`safeStorage`,
  `app.getPath`…), el mismo truco que la receta de esbuild de `AGENTS.md` — 07/11/2026,
  `2d8a21c`. Stub en `src/main/testing/electron.js`, con `safeStorageControl` para
  forzar sin keyring o un blob indescifrable (el cifrado lento llega con la 2b, `4671505`,
  cuando el stub pasa a la API asincrona). Define tambien `__MICROSOFT_CLIENT_ID__` y
  `__APP_VERSION__`
- [x] Tests **junto al fuente** (`X.test.js` al lado de `X.js`), que se renombran a `.test.ts`
  con el archivo que prueban. Sin carpeta `test/` ni objetivo de cobertura — 07/11/2026,
  `2d8a21c`. El soporte (stub y helper) vive en `src/main/testing/`, zona de 4
  espacios
- [x] Un unico helper compartido: `ConfigManager.launcherDir` en un directorio temporal con
  `getDefaultConfig()` y escritura de manifests sinteticos en `common/versions/**` —
  07/11/2026, `2d8a21c`: `createTempLauncher()` en `src/main/testing/tempLauncher.js`
- [x] Tests — **cobertura minima a proposito**: solo lo que hoy falla en silencio o lo que la
  migracion toca de lleno. Pocos casos por archivo, los que fijan cada regla de `AGENTS.md`
  — 07/11/2026, `2d8a21c`:
  - [x] `LaunchManager.test.js`: `rulesAllow` (ultima regla gana, `os.*`), y
        `buildLaunchCommand` (placeholder sin valor se lleva su `--flag`, dedupe del classpath
        con el loader ganando, RAM del modpack vs global). Tambien el suelo de RAM del modpack
        que no supera el techo
  - [x] `ConfigManager.test.js`: migracion v1→v2, `validateConfig` repara una clave mal tipada,
        sin keyring no se persisten credenciales. Añadidos, porque protegen la Fase 2b: los
        secretos no llegan en claro al disco y vuelven al cargar, un blob indescifrable solo
        cuesta la sesion, y (ya de la 2b, `4671505`) dos `save()` solapados no se pisan
  - [x] `AuthManager.test.js`: `classifyRestError` — un error transitorio no es terminal (sin
        red, 5xx, 429), `invalid_grant` si lo es y un 4xx desconocido no
  - [x] `PathUtils.test.js`: `resolveInside` rechaza la salida de la base
  - [x] `launchPhases.test.js`: todo `type` de fase tiene franja y `launchStep` no retrocede.
        Los `type` se leen del fuente de `LaunchManager` (glob de vite, `.js` o `.ts`) hasta
        que la union de la Fase 4 lo haga el compilador
- [~] Descartados por ahora (06/11/2026, cobertura minima): `loadVersionManifest`,
  `resolveLibraryArtifact`, `assertShape`, `PackPolicy`, `GameOutput`, `StartupTracker`,
  `SkinManager.parseProfile`, `toModpack`. Se añaden si la migracion de su archivo los pide

**Documentacion**
- [x] `AGENTS.md`: "Commands" con `pnpm test`; "Verifying Changes" pasa de la receta de esbuild a
  Vitest (la receta se queda solo para lo que necesite una red real) — 07/11/2026
- [x] `README.md`: seccion de contribucion con `pnpm test` — 07/11/2026, "Contributing" dentro
  de "Development"
- [x] `docs/adr/README.md`: fuera "No test runner" de las decisiones sin ADR — 07/11/2026

---

## Fase 2b — `safeStorage` asincrono (bloquea Electron 46)

Salio de la Fase 1: Electron 45 depreca los metodos sincronos de `safeStorage` y la 46 los
elimina. Va **despues** de la Fase 2 porque los tests de `ConfigManager` (cifrado, sin keyring)
son justo los que protegen este cambio, y **antes** de la Fase 5, para tipar `ConfigManager` ya
asincrono.

- [x] `isEncryptionAvailable` → `await safeStorage.isAsyncEncryptionAvailable()`,
  `encryptString` → `encryptStringAsync`, `decryptString` → `decryptStringAsync` (devuelve
  `{ result }`). Los blobs actuales se descifran con la API nueva: sin migracion de config —
  07/11/2026, `4671505`. Un blob con `shouldReEncrypt` hace que `load()` reescriba
  el archivo, igual que una cuenta v0
- [x] `ConfigManager.load()` y `save()` pasan a `async`; revisar **todos** los llamantes
  (`createWindow`, handlers IPC, `AuthManager`), que hoy cuentan con que `save()` lanza
  `CONFIG_SAVE_FAILED` de forma sincrona — 07/11/2026, `4671505`. Llamantes:
  `config.ipc.js` (8), `AuthManager` (alta, dos refrescos y `removeAccount`, que pasa a
  `async` igual que su llamante en `auth.ipc.js` y en `runAccountValidation`),
  `DistributionManager.setServerData` (pasa a `async`) y `LaunchManager.ensureJava`.
  `createWindow` espera a `load()` y se protege para no abrir dos ventanas si llega una
  segunda instancia o un `activate` mientras carga
- [x] Que dos `save()` concurrentes no se pisen: hoy son sincronos y no pueden solaparse;
  asincronos si (serializarlos en una cola o en una promesa encadenada) — 07/11/2026,
  `4671505`. Promesa encadenada (`pendingSave`): cada `save()` espera al anterior
  y serializa la config tal como esta en su turno; uno que falla rechaza para su llamante y
  no bloquea a los siguientes. Cubierto en `ConfigManager.test.js`
- [x] Tests de la Fase 2 en verde y prueba de humo de login + reinicio con sesion guardada —
  07/11/2026: 34 tests en verde en `4671505`; prueba de humo validada a mano por el usuario

**Documentacion**
- [x] `AGENTS.md`: "Authentication" (quitar la nota de Electron 45) y "Persistence" en Trust
  Boundaries (`save()` asincrono) — 07/11/2026
- [x] ADR-0007: addendum con el cambio hecho — 07/11/2026
- [x] `TODO.md`/este archivo: Electron deja de estar bloqueado en la 45 — 07/11/2026 (la
  subida a la 46 no se hace aqui; queda libre para cuando toque)

---

## Fase 3 — Infraestructura de TypeScript

Al terminar esta fase el proyecto compila y pasa el typecheck **sin haber convertido ningun
archivo de logica**. Desde aqui, **todo archivo nuevo nace en `.ts`/`.tsx`**.

- [x] **ADR-0015** (Proposed → Accepted): migracion incremental con `allowJs`, `strict` en todo
  `.ts`, validadores en runtime para los datos externos, `LauncherError`, sin libreria de
  esquemas (o con ella, si se decide otra cosa) — 07/11/2026, en el commit de documentacion
  de `ts/f2-f3-vitest-typescript` (la infraestructura que describe es `f91d49b`). Nace
  `Accepted`, **sin** libreria de esquemas, y fija TypeScript en 6.0.x (ver abajo)
- [x] Deps: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `typescript-eslint`
  — 07/11/2026, `f91d49b`. **TypeScript `~6.0.3`, no la 7**: `typescript-eslint`
  8.72 admite `<6.1` y la 7 (compilador nativo, `latest` en npm) no le sirve todavia.
  `@types/node` en la 22, la version local de Node
- [x] `tsconfig.json` con referencias + `tsconfig.node.json` (main, preload, shared) +
  `tsconfig.web.json` (renderer, shared). `allowJs: true`, `checkJs: false`, `strict: true`,
  `noEmit` (compila electron-vite; `tsc` solo comprueba) — 07/11/2026, `f91d49b`.
  Los dos proyectos llevan `composite: true` para que el editor acepte las referencias, y
  `noEmit` va en el script (`--noEmit --composite false`), como en la plantilla de
  electron-vite. El proyecto web no tiene tipos de node (el renderer va en sandbox)
- [x] Script `pnpm typecheck` (`tsc --noEmit` sobre los dos proyectos) — electron-vite **no**
  comprueba tipos, solo los elimina — 07/11/2026, `f91d49b` (`typecheck:node` y
  `typecheck:web` por separado)
- [x] Declaraciones globales: `__MICROSOFT_CLIENT_ID__`, `__APP_VERSION__`, `window.electronAPI`,
  imports `?asset&asarUnpack` (tipos de `electron-vite/node`) y de imagenes (`vite/client`) —
  07/11/2026, `f91d49b`: `src/main/env.d.ts` y `src/renderer/src/env.d.ts`.
  `window.electronAPI` va con un tipo laxo hasta el mapa de contratos de la Fase 4
- [x] `eslint.config.mjs`: bloques para `**/*.{ts,tsx}` con `typescript-eslint`, manteniendo las
  reglas actuales (sin `;`, comillas simples, `no-unused-vars` con `^_`) — 07/11/2026,
  `f91d49b`. `recommended` de `typescript-eslint` limitado a `**/*.{ts,tsx}`; el
  estilo sigue saliendo de los bloques por zona
- [x] **Indentacion: se conserva la de cada zona** (decidido el 06/11/2026, sin reformateo). Los
  globs de 4 espacios (`managers`/`utils`/`windows`) y de 2 (el resto) pasan a cubrir tambien
  `.ts`/`.tsx`, asi que un archivo convertido mantiene su ancho. ADR-0011 sigue en pie; su
  "unificar en el barrido de `typescript-eslint`" se retira con un addendum fechado —
  07/11/2026, `f91d49b`. `src/main/testing` entra en la zona de 4 (ya en `2d8a21c`), y la
  raiz de `src/main` pasa a `src/main/*.{js,ts}` (cubre `env.d.ts`)
- [x] Comprobar que `pnpm build` y `pnpm package` siguen produciendo lo mismo (preload en CJS)
  — 07/11/2026: `pnpm build` en cada commit de la rama, mismo chunk inicial (1.003 kB) y
  preload en CJS (`require("electron")`); `pnpm package` validado a mano por el usuario

**Documentacion**
- [x] `AGENTS.md`: comandos (`pnpm typecheck`), regla "archivos nuevos en TS", la regla de
  indentacion aplicada tambien a `.ts`/`.tsx`, y que el typecheck es parte del criterio de "hecho"
  — 07/11/2026. Tambien dos Gotchas: TypeScript fijado en 6.0 y los globales declarados en
  ESLint **y** en `env.d.ts`
- [x] ADR-0011: addendum (la unificacion no se hace en el barrido de TS) — 07/11/2026
- [x] `docs/adr/README.md`: fila de ADR-0015 — 07/11/2026
- [x] `eslint.config.mjs`: el comentario de cabecera sobre la indentacion (ya no apunta a P5) —
  07/11/2026 (no apuntaba a P5; ahora dice que los globs cubren `.ts`/`.tsx`)
- [x] `README.md`: contribucion con `pnpm typecheck` y la regla de archivos nuevos en TS —
  07/11/2026

---

## Fase 4 — Contratos compartidos (`src/shared`, preload, envelope IPC)

El mayor retorno de toda la migracion. Al cerrarla, **reestimar** las fases siguientes.

Hecha junto con la Fase 5 en la rama `ts/f4-f5-contracts-main` (07/11/2026, `614e673`…`c18e426`,
validada a mano por el usuario; lint, typecheck, test y build pasan en cada commit). Decisiones del usuario al empezar: `LauncherError` y los
guardas de cada manager entran con la conversion de ese archivo (no en commits aparte), los
handlers se registran desde un **mapa** tipado, y `LaunchManager` no se parte ahora (nota en
`TODO.md`).

- [x] `shared/errorCodes.js → .ts`: tipo `ErrorCode` (union de los valores) y
  `TERMINAL_AUTH_CODES` tipado — 07/11/2026, `614e673`. Tambien
  `isErrorCode` y `isTerminalAuthCode` como type guards
- [x] Clase `LauncherError` con `code: ErrorCode` (y `cause`) en `src/shared`; sustituir los ~34
  `error.code = …` del main **en commits por manager**, no en uno global — 07/11/2026,
  `614e673` (la clase). Sustituidos todos, cada uno en la conversion de su archivo (no
  queda ningun `error.code =` en main). `errorCodeOf(err, fallback)` es lo que leen el envelope
  y el evento `error` del lanzamiento: un codigo que no es del launcher (`ENOENT`) viaja como
  `UNKNOWN`
- [x] `shared/channels.js → .ts` + **mapa de contratos IPC** `canal → (args) => retorno` —
  07/11/2026, `614e673` (`channels`) y `2ead452`: `src/shared/ipcContract.ts` (`InvokeContract`,
  `SendContract`, `EventContract`, DTOs y `ElectronAPI`). `UndeclaredChannels` no compila si un
  nombre de `Channels` no esta en ningun contrato:
  - [x] `ipc/result.js → .ts`: `handle()` tipado contra el mapa y el envelope
        `{ ok: true, data } | { ok: false, code, message }` — los argumentos llegan al handler
        como `unknown` (`Untrusted<Args>`); `handleAll`, `listen` y `emit` completan el registro
  - [x] `preload/index.js → .ts` tipado contra el mapa (sigue saliendo en CJS) — comprobado en
        `out/preload/index.js` (`require("electron")`)
  - [x] `ipcClient.js → .ts`: el desenvoltorio reconstruye `LauncherError` — y
        `UnwrappedMethods` no compila si un metodo del puente no tiene envoltorio
  - [x] Resultado: un canal que falte en una de las 4 capas es error de compilacion —
        comprobado rompiendo cada capa a proposito: el error nombra el canal o el metodo
- [x] `launch:progress` como **union discriminada** por `type` (fases, ciclo de vida,
  `game_startup`, `stdout`/`stderr`); `launchPhases.js → .ts` con `PHASE_RANGE` tipado como
  `Record<PhaseType, …>` para que una fase sin franja no compile — 07/11/2026,
  `2ead452`: `src/shared/launchProgress.ts`. Con `LaunchManager` ya emitiendo la union, el test
  que leia su fuente con un glob de vite se ha quitado (`10701f3`): lo hace el compilador
- [x] `shared/skins.js → .ts` — 07/11/2026, `614e673`. Lleva tambien los tipos
  que cruzan el IPC (`SkinState`, `SkinSaveChoice`…) e `isSkinVariant`
- [x] Tipos del **manifest** (`docs/manifest.md`) y de **`config.json`** (incluido
  `CONFIG_VERSION`), en `src/shared` o `src/main/types` segun quien los use — 07/11/2026,
  `265df33`: `src/main/types/{config,manifest,minecraft}.ts`, en la zona de 4 espacios de
  `eslint.config.mjs`. Lo que ve el renderer (`Modpack`, `ManifestPointer`) va en
  `src/shared/modpack.ts` (`2ead452`)
- [x] Validadores en runtime como **type guards** sobre lo que ya existe (`assertShape`,
  `validateConfig`, `parseProfile`, `toModpack`): `unknown` entra, el tipo sale. Tipos a mano
  para Mojang version JSON y Fabric Meta, con solo los campos que se leen — 07/11/2026,
  tipados en el commit de cada manager. `assertShape` comprueba ahora
  tambien `policies`, `ignore`, `loader` y la `policy` de cada archivo; nuevo
  `DistributionManager.parseServerData` para el documento que llega por `distro:setServerData`
  (descarta una RAM que la JVM no lee). `toModpack` es del renderer y se tipa en la Fase 6

**Documentacion**
- [x] `AGENTS.md`: "IPC Pattern" (el mapa sustituye la verificacion manual de las 4 capas),
  "Progress event contract" (la union), y que los errores se lanzan con `LauncherError` —
  07/11/2026
- [x] ADR-0002 y ADR-0005: addendum fechado si el mecanismo cambia de forma — 07/11/2026, los
  dos (el mecanismo no cambia; lo que cambia es quien lo comprueba)
- [x] Reestimacion anotada en "Contexto" — 07/11/2026

---

## Fase 5 — Main process (de las hojas a la raiz)

Cada archivo: `git mv x.js x.ts` + tipos en el mismo commit (sin refactors), tests en verde. Los
tests del archivo se renombran a `.test.ts` con el.

Todo en `ts/f4-f5-contracts-main` (07/11/2026, un commit por grupo). Los tests (`src/main/testing`
incluido) pasaron a `.ts` con su archivo; 33 en verde (uno menos: el de `launchPhases` que leia
el fuente).

- [x] **utils**: `PathUtils` · `HttpUtils` · `MavenUtils` · `PackPolicy` · `FileUtils` ·
  `GameOutput` · `StartupTracker` · `Logger` (~490 lineas) — 07/11/2026, `265df33`
- [x] `constants.js` — 07/11/2026, `265df33`
- [x] `ConfigManager` (630) — 07/11/2026, `7d1f48e` (con `src/main/testing`). `config` arranca con los valores por defecto en vez
  de `null` (antes de `load()` nadie lo lee)
- [x] `ManifestManager` (167) — 07/11/2026, `505c553`. Fuera el `cache: 'no-store'` del `fetch`, que en
  Node no hacia nada (no hay cache HTTP) y no existe en sus tipos
- [x] `DistributionManager` (274) — 07/11/2026, `505c553`
- [x] `MinecraftDownloadManager` (105) — comprobar los `.d.ts` de helios-core, no suponerlos —
  07/11/2026, `93a3777`. El `VersionJson` de helios no trae `javaVersion`; se usa el tipo propio
- [x] `ModLoaderManager` (209) — 07/11/2026, `93a3777`
- [x] `LaunchManager` (1.028) — valorar partirlo **antes**, en un commit propio — 07/11/2026,
  `10701f3`, convertido sin partir (decision del usuario); el corte queda anotado en `TODO.md`. Un valor
  de argumento que no es string se descarta en vez de llegar a `spawn`, que rechazaba el comando
  entero
- [x] `AuthManager` (517) — 07/11/2026, `98a02fc`
- [x] `SkinManager` (677) — 07/11/2026, `3d07e2c`
- [x] `windows/msftAuth.js` (161) — 07/11/2026, `379e2c5`
- [x] `ipc/*.ipc.js` (auth, config, distribution, launch, logs, skins, window, index) —
  07/11/2026, `c18e426`. Cada archivo devuelve su parte del mapa (`satisfies Partial<InvokeHandlers>`, que
  tipa los argumentos como `unknown`) e `ipc/index.ts` las junta en un `InvokeHandlers`:
  quitar un handler no compila. Validacion nueva en el handler: el codigo de autorizacion y el
  uuid del logout, y las opciones de los dialogos (titulo y filtros)
- [x] `main/index.js` (181) — 07/11/2026, `c18e426`
- [x] Prueba de humo de la Fase 1 en `pnpm package` — 07/11/2026, hecha por el usuario

**Documentacion**
- [x] `AGENTS.md`: arbol de "Process Model" y todas las rutas `*.js` del main; seccion "Shared
  Utilities" — 07/11/2026

---

## Fase 6 — Renderer

- [ ] **services**: `firebase` · `firestoreService` · `imagePreload` · `skinTextures`
  (`ipcClient` y `launchPhases` ya se hicieron en la Fase 4)
- [ ] **contexts**: `StatusContext` · `ServersContext` · `AuthContext` · `LaunchContext`
  (el `switch` sobre la union de progreso con comprobacion exhaustiva: `never` en el `default`)
- [ ] **hooks**: `useServers`
- [ ] **P3 `useIpcResource<T>`** (con `reload` y loader arbitrario), en su propio commit,
  migrando los tres llamantes: `AuthContext`, `SettingsScreen`, `SkinManagerScreen`
- [ ] **components** por carpeta, cada una un commit: `common` · `auth` · `home` · `launch` ·
  `settings` · `skins` (vigilar que nada del inicio importe `skinview3d`: el chunk perezoso)
- [ ] `App.jsx` y `main.jsx`
- [ ] Prueba de humo de la Fase 1

**Documentacion**
- [ ] `AGENTS.md`: rutas del renderer, "State Management" (`useIpcResource`), Gotchas del chunk
  perezoso
- [ ] `TODO.md`: cerrar el item de P3

---

## Fase 7 — Cierre de la migracion

- [ ] Ningun `.js`/`.jsx` en `src/` → quitar `allowJs`
- [ ] Revisar los `any` y `@ts-expect-error` que hayan quedado, con un motivo escrito en cada uno
- [ ] Endurecer `tsconfig` si compensa (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [ ] `eslint.config.mjs` sin los bloques de JS que ya no apliquen
- [ ] Prueba de humo completa sobre el instalador
- [ ] PR `migration → main`, subir la version en `package.json` y publicar la release

**Documentacion**
- [ ] `AGENTS.md`: barrido final de rutas, extensiones, comandos y Gotchas (la nota de "la
  migracion a TS no depende de ESM" se va)
- [ ] `README.md`: stack y contribucion
- [ ] ADR-0015 → `Accepted` con un addendum de lo que cambio respecto al plan
- [ ] `TODO.md`: cerrar "Migracion a TypeScript"

---

## Fase 8 — Despues de la migracion (opcional, sale de este documento)

- [ ] `PackPolicy` unico en `src/shared/PackPolicy.ts` importado por `tools/pack-publish` con
  type-stripping nativo — comprobar antes la version de Node de la maquina que publica
- [ ] Mover a `TODO.md` lo que quede pendiente de aqui
- [ ] **Borrar este archivo** y su referencia en `AGENTS.md`
