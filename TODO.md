# TODO — NoNameLauncher

Pendientes ordenados por prioridad. Lo que se cierra sale de aqui: su historia esta en git y las decisiones en [`docs/adr/`](docs/adr/README.md). Los items marcados con 📋 salieron de la auditoria del 17/09/2026; el codigo `S`/`B`/`D` de cada uno es su identificador en esa revision (seguridad, bug, documentacion).

Lo que espera una intervencion externa o una decision esta al final, en **En espera**, y no compite con el resto.

## P1 — Bugs

Ninguno abierto.

## P2 — Calidad de codigo

- [ ] **Reforzar el tipado tras la migracion** — el tipado es solido (contratos IPC, union de progreso, guards en lo externo), pero quedan tipos que no prueban lo que dicen. En una rama propia, sin tocar comportamiento:
  - **Llevar los guards comunes a `src/shared/guards.ts`**, que ya existe con `isSha256Hex`: `isPlainObject` esta copiado 8 veces (7 en main, 1 en el renderer), y con el van `isOptional`, `text` y los de abajo. Sin dependencias, como todo `src/shared`
  - **Tipos con marca** (`string & { readonly __brand: '…' }`, borrables, validos con `erasableSyntaxOnly`) solo para valores que acaban en una ruta o una URL: `Sha256Hex` (hoy `isSha256Hex` estrecha a `string`; con la marca, `cachePath` y `ManifestPointer.hash` no aceptarian uno sin validar), `ModpackId` (`instanceDirFor` lo valida pero no estrecha el tipo, de ahi el `id as string` de `parseServerData`) y `SkinId` (la regex `SKIN_ID` esta duplicada en `skins.ipc.ts` y `SkinManager.ts`). Cada uno con su guard, que es la unica forma de obtenerlo
  - **Uniones cerradas**: `ManifestLoader.type` y `ModLoaderManager.detectModLoader` pasan de `string` a `'fabric' | 'forge' | 'vanilla'`, con `switch` exhaustivo (`never` en el `default`, como `LaunchContext`), para que un loader nuevo no compile hasta estar en todas partes
  - **Casts que sobran**: `account as unknown as DiskAccount` en `hydrateSecrets` (un guard `isDiskAccount`) y `state.files as InstanceState` en `DistributionManager.readState` (el fichero de disco se valida). Los de `validateConfig` y el de `getVersionJson()` de helios se quedan, con el motivo al lado
  - **No**: libreria de esquemas (Zod y similares), marcar todo (rutas, usernames) ni `exactOptionalPropertyTypes` (rechazado en el addendum de [ADR-0015](docs/adr/0015-incremental-typescript-migration.md))
- [ ] **Partir `LaunchManager`** (~1.060 lineas) — junta cuatro trabajos que no se necesitan entre si: la gestion de Java (`checkJava` → `ensureJava`, ~170 lineas), las librerias y argumentos de version (`resolveLibraryArtifact`, `loadVersionManifest`, `rulesAllow`, `appendArguments`, `buildLaunchCommand`), el flujo de lanzamiento (`launchMinecraft`, `waitForSpawn`) y el ciclo de vida del juego (`killGame`, `releaseGame`, `running-game.json`, `findOrphanGame`). Hacerlo como cambio propio, sin tocar comportamiento, con `LaunchManager.test.ts` en verde antes y despues; los tests de `rulesAllow`/`buildLaunchCommand` se mueven con lo que prueban. Ojo con `launchInProgress`/`gameProcess`, que lee `window.ipc.ts` (cierre) y `config.ipc.ts` (`isGameRunning`)

## P3 — Funcionalidades

- [ ] **Recargar la lista de modpacks al recuperar el foco** — hoy el catalogo se lee una vez al abrir (o al cambiar de cuenta) y solo "Reintentar" lo vuelve a pedir, asi que un modpack publicado con el launcher abierto no aparece hasta reiniciarlo. Lo que tiene que estar fresco al lanzar ya lo esta: `prepareLaunch` relee el documento al pulsar JUGAR. Propuesta: un listener de `focus` en `useServers` que llame al `reload` existente si han pasado ≥5 min desde la ultima carga, y que deseleccione el modpack elegido si ya no viene en la lista nueva
  - **Descartado el tiempo real** (`onSnapshot`): exige volver al SDK completo de Firestore (~320 kB mas en el chunk inicial, conexion persistente) y reabre lo que [ADR-0009](docs/adr/0009-no-offline-mode.md) resolvio, porque el SDK completo encola lecturas sin conexion en vez de fallar. El catalogo cambia pocas veces y lo publica el propio equipo
- [ ] **Calibrar los hitos de la barra de arranque** — `STARTUP_MILESTONES` (`src/main/utils/StartupTracker.ts`) esta escrito contra el formato de log de Fabric en 1.20.x, no medido con los modpacks que se publican. Lanzarlos, guardar el log desde el modal y ajustar patrones y porcentajes. Un hito que no casa solo se salta y la barra se cierra igual por silencio o a los 3 minutos, asi que el fallo es cosmetico

## P4 — Mantenimiento

- [ ] 📋 **Podar caches (B16)** — `manifests/<hash>.json` y los JDK de `runtime/` no se borran nunca. Lo que pesa son los JDK (~190 MB cada uno). Conservar el manifest actual de cada modpack y los JDK que use algun modpack
- [ ] 📋 **OAuth: PKCE (S7)** — el flujo no usa PKCE ni `state`; la ventana embebida lo mitiga, pero RFC 8252 lo recomienda para clientes publicos. `MicrosoftAuth.getAccessToken` de helios no acepta `code_verifier`, asi que haria falta un canje propio

## En espera

No se empiezan hasta que cambie lo que las bloquea.

### Requieren intervencion externa o estan bloqueados

- [ ] 📋 **La publicacion no es atomica y el rollback no existe (B1)** — cambia la estructura del bucket R2 y obliga a republicar los packs. Los ficheros del bucket se direccionan por **ruta** (`<packId>/files/<path>`) y `rclone sync` los sobrescribe y borra en el sitio (`tools/pack-publish/publish.mjs:150`). Entre la subida y el cambio de puntero, Firestore apunta al manifest v1 y el CDN sirve ficheros v2, asi que el lanzamiento falla por checksum; y "volver a apuntar a la v1" no restaura nada porque sus ficheros ya no existen. Hoy solo lo contiene el paso manual de `maintenance`, que ademas no para un lanzamiento que ya paso `prepareLaunch`
  - Solucion: almacenamiento **direccionado por contenido** — el manifest ya lleva el sha256 de cada fichero, asi que el launcher puede componer `<base>/objects/<hash[0:2]>/<hash>` y el publicador sube con `rclone copy` (nunca `sync`) solo los objetos que faltan. Con eso publicar es de verdad atomico, el rollback es cambiar el puntero y el paso de `maintenance` deja de ser obligatorio. Alternativa mas barata: prefijo por version (`<packId>/<version>/files/`), a costa de resubir el pack entero en cada version
  - Cambia el contrato launcher↔tools: `formatVersion` 2 en el mismo commit en `ManifestManager.fileUrl`, `generate.mjs`, `publish.mjs` y `docs/manifest.md`. Con el, `PackManifest` pasa a ser una union sobre `formatVersion`. Propuesta escrita en [ADR-0012](docs/adr/0012-content-addressed-pack-files.md) (Proposed); la documentacion ya describe el comportamiento real ("Publishing and rollback" en `docs/manifest.md`). Cuanto mas se publique, mas cara sale la migracion: conviene decidir el ADR aunque se implemente despues
- [ ] **Reforzar `usersAllowed` en Firestore Rules** — no es implementable a dia de hoy. `firebase.ts` solo hace `initializeApp` + `getFirestore`: **el launcher no autentica contra Firebase**, asi que en las reglas `request.auth` es siempre `null` y no existe ninguna identidad por la que filtrar `usersAllowed`. El filtrado sigue siendo client-side y cualquiera con el bundle puede leer el catalogo completo
  - **Via A — Cloud Function + custom token.** Una Function valida el accessToken de Minecraft contra `api.minecraftservices.com/minecraft/profile` y emite un custom token de Firebase con el username como claim; el renderer hace `signInWithCustomToken` y la regla queda `allow read: if resource.data.usersAllowed.size() == 0 || request.auth.token.mcUsername in resource.data.usersAllowed`. Es la solucion real, pero exige **plan Blaze** (Spark no permite salida de red a servicios no-Google) e infraestructura nueva que mantener
  - **Via B — rediseñar el dato.** Las reglas permiten leer solo documentos con `isPublic == true` y los packs privados dejan de ser "publicos pero ocultos": pasan a no ser legibles sin identidad. Cierra la fuga sin backend, pero cambia el modelo de `usersAllowed`
  - Mientras tanto, `usersAllowed` es **solo UX** y no debe presentarse como control de acceso ([ADR-0006](docs/adr/0006-usersallowed-is-ux-not-access-control.md))
- [ ] **Soporte de NeoForge** — bloqueado por Forge: `tools/pack-publish` rechaza los packs que no son Fabric, asi que `ModLoaderManager.installForge` nunca se ha ejecutado (ver "Pending" en `docs/manifest.md`). Solo si algun modpack lo necesita. Su instalador es un fork del de Forge y acepta el mismo `--installClient`, asi que `installForge` sirve tal cual; solo cambia el host del maven (`maven.neoforged.net`). El riesgo esta en el id de version, que no es uniforme: `neoforge-21.1.72` en MC 1.20.2+ pero `1.20.1-forge-47.1.106` en 1.20.1. Leerlo del `version.json` que hay dentro del jar del instalador en vez de componerlo con una plantilla; `adm-zip` vuelve a añadirse con este item

### Pendientes de decision

- [ ] **Auto-update** (electron-updater) — falta analizar si compensa: donde se alojan las releases (GitHub Releases u otro), el coste de mantener el canal y como encaja con un instalador sin firmar
- [ ] **Firma de codigo en Windows** — sin ella el instalador y el portable disparan SmartScreen, pero exige un certificado de pago. Va con la decision del auto-update
- [ ] **Cancelar descarga/lanzamiento** (decidido el 05/11/2026) — una vez se pulsa JUGAR no hay forma de cancelar. El analisis ya esta hecho y lo que falta es elegir el alcance:
  - El bloqueo es helios: `downloadQueue`/`downloadFile` hacen `got.stream(url)` sin señal, asi que un fichero **en curso** no se puede abortar. `MojangIndexProcessor` y `extractJdk` tampoco aceptan señal
  - **Cooperativa** — un `AbortSignal` que atraviese la cadena: se corta entre pasos y entre ficheros (cola propia sobre `downloadFile` de helios, sin encolar mas), y los que ya estan en vuelo (≤15) terminan antes de soltar el `launchInProgress`. Segundos con mods y assets, pero el JDK (~190 MB, un solo `downloadFile`) no se interrumpe a medias. Respeta la regla de "descargas por `helios-core/dl`"
  - **Inmediata** — downloader propio (`fetch` + `pipeline` + señal + reintentos) que sustituya `downloadQueue`/`downloadFile`. Cancela al instante, JDK incluido, pero rompe esa regla de `AGENTS.md` y pide un ADR
  - Mientras tanto, cerrar el launcher durante la preparacion pide confirmacion y corta el proceso ([ADR-0013](docs/adr/0013-the-game-outlives-the-launcher.md)); lo descargado a medias se revalida por hash en el siguiente lanzamiento
