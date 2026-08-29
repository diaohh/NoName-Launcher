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
export const PHASE_RANGE = {
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
 * Overall completion for a progress event, or null when the phase is unknown — which is
 * the only case where the bar should still show an indeterminate pulse.
 *
 * A phase that reports no countable total lands on its floor and waits there. That is
 * still forward movement, which is the whole point.
 */
export function phasePercent(type, current, total) {
  const range = PHASE_RANGE[type]
  if (!range) return null

  const [floor, ceiling] = range
  if (!(total > 0) || !(current >= 0)) return floor

  const fraction = Math.min(1, current / total)
  return Math.round(floor + fraction * (ceiling - floor))
}
