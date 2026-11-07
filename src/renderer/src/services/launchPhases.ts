import type { PhaseType } from '../../../shared/launchProgress'

/**
 * The slice of the progress bar each launch phase owns.
 *
 * The bar used to render `current / total` on its own, so it restarted from zero at
 * every phase and fell back to an indeterminate pulse whenever a step could not count
 * anything. Giving each phase a floor and a ceiling makes the bar mean "how far through
 * the launch", which is the question the player is actually asking.
 *
 * The order mirrors `LaunchManager.launchMinecraft`. The widths are rough weights, not
 * measurements: the two download phases get the most because they are what actually
 * takes time on a cold instance.
 */
export const PHASE_RANGE: Record<PhaseType, readonly [floor: number, ceiling: number]> = {
  auth: [0, 4],
  manifest: [4, 8],
  validation: [8, 20],
  download_mods: [20, 45],
  download: [45, 68],
  java: [68, 70],
  java_discover: [70, 72],
  java_download: [72, 82],
  java_extract: [82, 85],
  modloader: [85, 92],
  download_libraries: [92, 98],
  launch: [98, 100]
}

/**
 * What the progress bar's header says for each phase. The header used to print the raw
 * `type` — "download_mods", "java_discover" — straight at the player.
 *
 * `download` rarely needs its entry: MinecraftDownloadManager sends its own sub-phase name,
 * already in Spanish, and that is what the header shows instead.
 */
export const PHASE_LABEL: Record<PhaseType, string> = {
  auth: 'Verificando cuenta',
  manifest: 'Leyendo modpack',
  validation: 'Validando archivos',
  download_mods: 'Actualizando modpack',
  download: 'Descargando Minecraft',
  java: 'Preparando Java',
  java_discover: 'Buscando Java',
  java_download: 'Descargando Java',
  java_extract: 'Instalando Java',
  modloader: 'Instalando mod loader',
  download_libraries: 'Descargando librerias',
  launch: 'Iniciando Minecraft'
}

/**
 * Header of the tracker's last step, which follows the game from `started` to its title screen.
 *
 * `game_startup` deliberately has no slice in PHASE_RANGE: when it arrives the preparation
 * is already at 100%, so the startup is a step of its own, 0-100, driven by milestones
 * in the game's output (main/utils/StartupTracker). It is also the one type that repeats,
 * which is harmless precisely because it stays out of the phase map.
 */
export const STARTUP_LABEL = 'Arrancando Minecraft'

/**
 * The points on the launch tracker. The player sees one bar split into these steps: the
 * stretch of the step in progress fills from 0 to 100, and its point gets a check once the
 * next step starts, so a launch reads as "step 2 of 4" rather than as twelve phases.
 *
 * The preparation steps are cuts across PHASE_RANGE, not weights of their own: `until` is the
 * percentage where the step ends, and it must fall on a phase boundary there. A phase belongs
 * to the step its floor falls in, so a new phase with a slice joins the right step by itself.
 * Phases the launch skips (Java already installed, loader already there) simply never arrive,
 * and the step is still checked when a later one starts.
 *
 * The last step is the game's own startup, `game_startup`, on its own 0-100 scale.
 */
export interface LaunchStep {
  label: string
  /** Where the step ends on PHASE_RANGE's scale. The last step, the game's startup, has none. */
  until?: number
}

export const LAUNCH_STEPS: readonly LaunchStep[] = [
  { label: 'Verificar', until: 20 },
  { label: 'Descargar', until: 68 },
  { label: 'Preparar', until: 100 },
  { label: 'Iniciar' }
]

export function isPhaseType(type: string): type is PhaseType {
  return Object.hasOwn(PHASE_RANGE, type)
}

/** Where a preparation step ends; the first one starts at 0. */
function stepEnd(index: number): number {
  return LAUNCH_STEPS[index]?.until ?? 100
}

/**
 * Which preparation step a progress event belongs to, and how far through that step the
 * launch is (0-100, or null while nothing countable has arrived).
 */
export function launchStep(type: string, percent: number | null): { index: number, percent: number | null } {
  if (!isPhaseType(type)) return { index: 0, percent: null }
  const range = PHASE_RANGE[type]

  const index = LAUNCH_STEPS.findIndex(step => step.until != null && range[0] < step.until)
  if (percent == null) return { index, percent: null }

  const from = index === 0 ? 0 : stepEnd(index - 1)
  const until = stepEnd(index)
  const fraction = Math.min(1, Math.max(0, (percent - from) / (until - from)))
  return { index, percent: Math.round(fraction * 100) }
}

/**
 * Overall completion for a progress event, or null when the phase is unknown — which is
 * the only case where the bar should still show an indeterminate pulse.
 *
 * A phase that reports no countable total lands on its floor and waits there. That is
 * still forward movement, which is the whole point.
 */
export function phasePercent(type: string, current: number, total: number): number | null {
  if (!isPhaseType(type)) return null

  const [floor, ceiling] = PHASE_RANGE[type]
  if (!(total > 0) || !(current >= 0)) return floor

  const fraction = Math.min(1, current / total)
  return Math.round(floor + fraction * (ceiling - floor))
}
