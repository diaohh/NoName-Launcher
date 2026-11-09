# TODO — NoNameLauncher

Pendientes ordenados por prioridad. Lo que se cierra sale de aqui: su historia esta en git y las decisiones en [`docs/adr/`](docs/adr/README.md). Los items marcados con 📋 salieron de la auditoria del 17/09/2026; el codigo `S`/`B`/`D` de cada uno es su identificador en esa revision (seguridad, bug, documentacion).

Lo que espera una intervencion externa o una decision esta al final, en **En espera**, y no compite con el resto.

## P1 — Bugs

Ninguno abierto.

## P2 — Calidad de codigo

Ninguno abierto.

## P3 — Funcionalidades

- [ ] **Calibrar los hitos de la barra de arranque** — `STARTUP_MILESTONES` (`src/main/utils/StartupTracker.ts`) esta escrito contra el formato de log de Fabric en 1.20.x, no medido con los modpacks que se publican. Lanzarlos, guardar el log desde el modal y ajustar patrones y porcentajes. Un hito que no casa solo se salta y la barra se cierra igual por silencio o a los 3 minutos, asi que el fallo es cosmetico

## P4 — Mantenimiento

- [ ] 📋 **Podar caches (B16)** — `manifests/<hash>.json` y los JDK de `runtime/` no se borran nunca. Lo que pesa son los JDK (~190 MB cada uno). Conservar el manifest actual de cada modpack y los JDK que use algun modpack
  - **Pendiente de analizar si compensa** (09/11/2026). Los manifests pesan KB y son despreciables; los JDK solo se acumulan si los modpacks cambian de version de Java (p. ej. 17 → 21, ~200-300 MB sin uso), si el runtime cacheado deja de validar o si una descarga se corta. Un jugador normal tiene 1-2 JDK, ambos en uso. Frente a eso, podar es codigo que **borra del disco del jugador**, con casos delicados
  - Se llego a implementar y se deshizo hasta decidirlo: registrar en `.nnl-state.json` el hash del manifest y el major de Java de cada lanzamiento, y al arrancar borrar los manifests sin referencia y lo que sobre en `<dataDir>/runtime/<arch>`. Los casos que cubria: no tocar `runtime/` si alguna instancia no tiene el major registrado, si hay un juego huerfano vivo o si empieza un lanzamiento; mover a `runtime/.pruned` antes de borrar, para que helios no descubra un JDK a medio borrar (en Windows el rename falla si una JVM lo usa); nunca borrar un Java del sistema ni el elegido por el jugador. Sin manager nuevo: cada parte en su dueño (`DistributionManager`, `ManifestManager`, la gestion de Java)

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
- [ ] **Cupo de lecturas de Firestore** — en el plan Spark (50.000 lecturas/dia) el catalogo cuesta una lectura por modpack cada vez que se lee ([ADR-0016](docs/adr/0016-refresh-the-catalogue-on-demand.md)). Los jugadores no llegan ni de lejos, pero la API key va en el bundle y las reglas dejan leer sin identidad, asi que un script puede agotar el cupo y dejar el catalogo fallando para todos hasta el reinicio diario. Opciones, de menos a mas esfuerzo: plan **Blaze con alerta de presupuesto** (~0,06 $ por 100.000 lecturas, sin corte), un **documento indice** (`meta/catalogue` con una `version`: 1 lectura por comprobacion en vez de N, a costa de que una edicion a mano olvide subirla) o servir el **catalogo como JSON desde R2**, como el manifest. Comparte causa con el item de `usersAllowed`
- [ ] **Cancelar descarga/lanzamiento** (decidido el 05/11/2026) — una vez se pulsa JUGAR no hay forma de cancelar. El analisis ya esta hecho y lo que falta es elegir el alcance:
  - El bloqueo es helios: `downloadQueue`/`downloadFile` hacen `got.stream(url)` sin señal, asi que un fichero **en curso** no se puede abortar. `MojangIndexProcessor` y `extractJdk` tampoco aceptan señal
  - **Cooperativa** — un `AbortSignal` que atraviese la cadena: se corta entre pasos y entre ficheros (cola propia sobre `downloadFile` de helios, sin encolar mas), y los que ya estan en vuelo (≤15) terminan antes de soltar el `launchInProgress`. Segundos con mods y assets, pero el JDK (~190 MB, un solo `downloadFile`) no se interrumpe a medias. Respeta la regla de "descargas por `helios-core/dl`"
  - **Inmediata** — downloader propio (`fetch` + `pipeline` + señal + reintentos) que sustituya `downloadQueue`/`downloadFile`. Cancela al instante, JDK incluido, pero rompe esa regla de `AGENTS.md` y pide un ADR
  - Mientras tanto, cerrar el launcher durante la preparacion pide confirmacion y corta el proceso ([ADR-0013](docs/adr/0013-the-game-outlives-the-launcher.md)); lo descargado a medias se revalida por hash en el siguiente lanzamiento
