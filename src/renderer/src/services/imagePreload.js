/**
 * Images already requested, by URL. Holding the element keeps the decoded image in
 * Chromium's memory cache, so selecting a modpack later paints its banner at once instead
 * of downloading and decoding a full-window image while the crossfade runs.
 */
const preloaded = new Map()

/**
 * Starts downloading and decoding images the player is likely to see next.
 * Fire and forget: a failure only drops the entry, the component that shows the image
 * handles its own error.
 *
 * @param {Array<string|null|undefined>} urls
 */
export function preloadImages(urls) {
  for (const url of urls) {
    if (!url || preloaded.has(url)) continue

    const img = new Image()
    img.src = url
    img.decode().catch(() => preloaded.delete(url))
    preloaded.set(url, img)
  }
}
