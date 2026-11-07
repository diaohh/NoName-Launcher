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
  vacia tras el logout. Falta probar un login real a mano
- [ ] S9: addendum fechado en ADR-0007 (el `accessToken` viaja en la linea de comandos del juego)

**Documentacion**
- [ ] `TODO.md`: marcar los items de P5 correspondientes y quitar `firestore/lite` de la lista
- [ ] `AGENTS.md`: la nota de Gotchas sobre el bundle de Firebase y la de ADR-0007 si cambia algo

---

## Fase 1 — Electron 37 → 44 y actualizaciones de dependencias

En una rama propia, **antes** de cualquier `.ts`. Un commit por salto relevante, para poder
bisecar.

- [ ] Leer los breaking changes de Electron 38→44 y anotar aqui los que tocan APIs que usamos:
  `safeStorage`, `powerMonitor`, `session.webRequest` (CSP, ADR-0010), `sandbox`, ventana sin
  marco, `requestSingleInstanceLock`, `shell.trashItem`, `dialog`, `BrowserWindow` del login
- [ ] `electron` 37.1.0 → 44.x
- [ ] `electron-builder` a la ultima 26.x (arrastra la mayoria de avisos de tar/minimatch/xmldom)
- [ ] `vite` 6 → 8 y `@vitejs/plugin-react` 4 → 6 — **comprobar antes los `peerDependencies`
  de `electron-vite`**; si su version actual no soporta vite 8, subir a la mayor que soporte (o
  subir electron-vite) y anotarlo
- [ ] Menores: `react`/`react-dom`, `firebase`, `postcss`, `tailwindcss`
- [ ] `pnpm audit --prod` sigue a 0; anotar el total de `pnpm audit` antes y despues
- [ ] Prueba de humo manual en `pnpm dev` **y** en el instalador de `pnpm package`:
  - [ ] login Microsoft, reinicio del launcher con la sesion guardada (`safeStorage`)
  - [ ] lanzar un modpack Fabric de punta a punta, ver logs, matar el juego
  - [ ] cerrar el launcher con el juego abierto (el juego sobrevive, ADR-0013) y durante la
        preparacion (confirmacion de `CloseGuard`)
  - [ ] segunda instancia enfoca la primera
  - [ ] gestor de skins: importar, guardar skin/capa, borrar a la papelera
  - [ ] ajustes: RAM, Java manual, directorio de datos

**Documentacion**
- [ ] `AGENTS.md`: "Electron 37" en la cabecera del proyecto y cualquier gotcha nuevo
- [ ] `README.md`: versiones si aparecen
- [ ] `TODO.md`: cerrar "Electron 37 → 44" y "Actualizaciones menores"

---

## Fase 2 — Vitest y tests de caracterizacion (sobre el JS actual)

Los tests se escriben **contra el comportamiento actual**, sin cambiar codigo. Son la red de
seguridad de las Fases 4–7: un archivo convertido a TS tiene que pasar los mismos tests.

- [ ] Añadir `vitest` (devDependency) y el script `pnpm test`
- [ ] `vitest.config.mjs` propio: la config de electron-vite es multi-objetivo y no se puede
  reutilizar tal cual. Alias de `electron` a un stub de pruebas (`safeStorage`,
  `app.getPath`…), el mismo truco que la receta de esbuild de `AGENTS.md`
- [ ] Tests **junto al fuente** (`X.test.js` al lado de `X.js`), que se renombran a `.test.ts`
  con el archivo que prueban. Sin carpeta `test/` ni objetivo de cobertura
- [ ] Un unico helper compartido: `ConfigManager.launcherDir` en un directorio temporal con
  `getDefaultConfig()` y escritura de manifests sinteticos en `common/versions/**`
- [ ] Tests — **cobertura minima a proposito**: solo lo que hoy falla en silencio o lo que la
  migracion toca de lleno. Pocos casos por archivo, los que fijan cada regla de `AGENTS.md`:
  - [ ] `LaunchManager.test.js`: `rulesAllow` (ultima regla gana, `os.*`), y
        `buildLaunchCommand` (placeholder sin valor se lleva su `--flag`, dedupe del classpath
        con el loader ganando, RAM del modpack vs global)
  - [ ] `ConfigManager.test.js`: migracion v1→v2, `validateConfig` repara una clave mal tipada,
        sin keyring no se persisten credenciales
  - [ ] `AuthManager.test.js`: `classifyRestError` — un error transitorio no es terminal
  - [ ] `PathUtils.test.js`: `resolveInside` rechaza la salida de la base
  - [ ] `launchPhases.test.js`: todo `type` de fase tiene franja y `launchStep` no retrocede
- [~] Descartados por ahora (06/11/2026, cobertura minima): `loadVersionManifest`,
  `resolveLibraryArtifact`, `assertShape`, `PackPolicy`, `GameOutput`, `StartupTracker`,
  `SkinManager.parseProfile`, `toModpack`. Se añaden si la migracion de su archivo los pide

**Documentacion**
- [ ] `AGENTS.md`: "Commands" con `pnpm test`; "Verifying Changes" pasa de la receta de esbuild a
  Vitest (la receta se queda solo para lo que necesite una red real)
- [ ] `README.md`: seccion de contribucion con `pnpm test`

---

## Fase 3 — Infraestructura de TypeScript

Al terminar esta fase el proyecto compila y pasa el typecheck **sin haber convertido ningun
archivo de logica**. Desde aqui, **todo archivo nuevo nace en `.ts`/`.tsx`**.

- [ ] **ADR-0015** (Proposed → Accepted): migracion incremental con `allowJs`, `strict` en todo
  `.ts`, validadores en runtime para los datos externos, `LauncherError`, sin libreria de
  esquemas (o con ella, si se decide otra cosa)
- [ ] Deps: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `typescript-eslint`
- [ ] `tsconfig.json` con referencias + `tsconfig.node.json` (main, preload, shared) +
  `tsconfig.web.json` (renderer, shared). `allowJs: true`, `checkJs: false`, `strict: true`,
  `noEmit` (compila electron-vite; `tsc` solo comprueba)
- [ ] Script `pnpm typecheck` (`tsc --noEmit` sobre los dos proyectos) — electron-vite **no**
  comprueba tipos, solo los elimina
- [ ] Declaraciones globales: `__MICROSOFT_CLIENT_ID__`, `__APP_VERSION__`, `window.electronAPI`,
  imports `?asset&asarUnpack` (tipos de `electron-vite/node`) y de imagenes (`vite/client`)
- [ ] `eslint.config.mjs`: bloques para `**/*.{ts,tsx}` con `typescript-eslint`, manteniendo las
  reglas actuales (sin `;`, comillas simples, `no-unused-vars` con `^_`)
- [ ] **Indentacion: se conserva la de cada zona** (decidido el 06/11/2026, sin reformateo). Los
  globs de 4 espacios (`managers`/`utils`/`windows`) y de 2 (el resto) pasan a cubrir tambien
  `.ts`/`.tsx`, asi que un archivo convertido mantiene su ancho. ADR-0011 sigue en pie; su
  "unificar en el barrido de `typescript-eslint`" se retira con un addendum fechado
- [ ] Comprobar que `pnpm build` y `pnpm package` siguen produciendo lo mismo (preload en CJS)

**Documentacion**
- [ ] `AGENTS.md`: comandos (`pnpm typecheck`), regla "archivos nuevos en TS", la regla de
  indentacion aplicada tambien a `.ts`/`.tsx`, y que el typecheck es parte del criterio de "hecho"
- [ ] ADR-0011: addendum (la unificacion no se hace en el barrido de TS)
- [ ] `docs/adr/README.md`: fila de ADR-0015
- [ ] `eslint.config.mjs`: el comentario de cabecera sobre la indentacion (ya no apunta a P5)

---

## Fase 4 — Contratos compartidos (`src/shared`, preload, envelope IPC)

El mayor retorno de toda la migracion. Al cerrarla, **reestimar** las fases siguientes.

- [ ] `shared/errorCodes.js → .ts`: tipo `ErrorCode` (union de los valores) y
  `TERMINAL_AUTH_CODES` tipado
- [ ] Clase `LauncherError` con `code: ErrorCode` (y `cause`) en `src/shared`; sustituir los ~34
  `error.code = …` del main **en commits por manager**, no en uno global
- [ ] `shared/channels.js → .ts` + **mapa de contratos IPC** `canal → (args) => retorno`:
  - [ ] `ipc/result.js → .ts`: `handle()` tipado contra el mapa y el envelope
        `{ ok: true, data } | { ok: false, code, message }`
  - [ ] `preload/index.js → .ts` tipado contra el mapa (sigue saliendo en CJS)
  - [ ] `ipcClient.js → .ts`: el desenvoltorio reconstruye `LauncherError`
  - [ ] Resultado: un canal que falte en una de las 4 capas es error de compilacion
- [ ] `launch:progress` como **union discriminada** por `type` (fases, ciclo de vida,
  `game_startup`, `stdout`/`stderr`); `launchPhases.js → .ts` con `PHASE_RANGE` tipado como
  `Record<PhaseType, …>` para que una fase sin franja no compile
- [ ] `shared/skins.js → .ts`
- [ ] Tipos del **manifest** (`docs/manifest.md`) y de **`config.json`** (incluido
  `CONFIG_VERSION`), en `src/shared` o `src/main/types` segun quien los use
- [ ] Validadores en runtime como **type guards** sobre lo que ya existe (`assertShape`,
  `validateConfig`, `parseProfile`, `toModpack`): `unknown` entra, el tipo sale. Tipos a mano
  para Mojang version JSON y Fabric Meta, con solo los campos que se leen

**Documentacion**
- [ ] `AGENTS.md`: "IPC Pattern" (el mapa sustituye la verificacion manual de las 4 capas),
  "Progress event contract" (la union), y que los errores se lanzan con `LauncherError`
- [ ] ADR-0002 y ADR-0005: addendum fechado si el mecanismo cambia de forma
- [ ] Reestimacion anotada en "Contexto"

---

## Fase 5 — Main process (de las hojas a la raiz)

Cada archivo: `git mv x.js x.ts` + tipos en el mismo commit (sin refactors), tests en verde. Los
tests del archivo se renombran a `.test.ts` con el.

- [ ] **utils**: `PathUtils` · `HttpUtils` · `MavenUtils` · `PackPolicy` · `FileUtils` ·
  `GameOutput` · `StartupTracker` · `Logger` (~490 lineas)
- [ ] `constants.js`
- [ ] `ConfigManager` (630)
- [ ] `ManifestManager` (167)
- [ ] `DistributionManager` (274)
- [ ] `MinecraftDownloadManager` (105) — comprobar los `.d.ts` de helios-core, no suponerlos
- [ ] `ModLoaderManager` (209)
- [ ] `LaunchManager` (1.028) — valorar partirlo **antes**, en un commit propio
- [ ] `AuthManager` (517)
- [ ] `SkinManager` (677)
- [ ] `windows/msftAuth.js` (161)
- [ ] `ipc/*.ipc.js` (auth, config, distribution, launch, logs, skins, window, index)
- [ ] `main/index.js` (181)
- [ ] Prueba de humo de la Fase 1 en `pnpm package`

**Documentacion**
- [ ] `AGENTS.md`: arbol de "Process Model" y todas las rutas `*.js` del main; seccion "Shared
  Utilities"

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
