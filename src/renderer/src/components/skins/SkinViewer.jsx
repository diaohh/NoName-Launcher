import { useEffect, useRef } from 'react'
import { IdleAnimation, SkinViewer as Viewer } from 'skinview3d'
import { loadImage } from '../../services/skinTextures'

/**
 * The 3D player, through skinview3d: drag to turn it, wheel to zoom.
 *
 * WebGL is imperative, so the viewer lives in effects: one creates it and disposes of it,
 * one follows the size of the box, and one per texture loads it. Textures are decoded here
 * and handed over synchronously, guarded by `ignore`, so a quick change of selection can
 * never leave an older texture painted over the newer one.
 *
 * @param {string|null} skin    Skin texture as a data URL.
 * @param {'classic'|'slim'} variant
 * @param {string|null} cape    Cape texture as a data URL; null shows no cape.
 * @param {boolean} elytra      Show the cape texture as an elytra instead.
 * @param {boolean} showBack    Turn the player around, so a cape is seen.
 * @param {(err: Error) => void} onError
 */
export default function SkinViewer({ skin, variant, cape, elytra, showBack, onError }) {
  const boxRef = useRef(null)
  const viewerRef = useRef(null)

  // Each viewer gets a canvas of its own, created here and removed on cleanup, and its WebGL
  // context is released on the spot: skinview3d's dispose() leaves it alive, and opening the
  // screen again (or StrictMode's double mount) would otherwise stack contexts on one canvas
  // until Chromium starts dropping the oldest.
  useEffect(() => {
    const box = boxRef.current
    const viewer = new Viewer({
      width: box.clientWidth,
      height: box.clientHeight
    })
    viewer.canvas.className = 'absolute top-0 left-0'
    box.appendChild(viewer.canvas)

    viewer.controls.enablePan = false
    // The idle sway is decoration; the player can still turn the model by hand.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewer.animation = reduceMotion ? null : new IdleAnimation()
    viewerRef.current = viewer

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) viewer.setSize(width, height)
    })
    observer.observe(box)

    return () => {
      observer.disconnect()
      viewer.dispose()
      viewer.renderer.forceContextLoss()
      viewer.canvas.remove()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!skin) {
      viewerRef.current?.loadSkin(null)
      return
    }

    let ignore = false
    loadImage(skin)
      .then(image => {
        if (!ignore) viewerRef.current?.loadSkin(image, { model: variant === 'slim' ? 'slim' : 'default' })
      })
      .catch(err => {
        if (!ignore) onError?.(err)
      })

    return () => { ignore = true }
  }, [skin, variant, onError])

  useEffect(() => {
    if (!cape) {
      viewerRef.current?.loadCape(null)
      return
    }

    let ignore = false
    loadImage(cape)
      .then(image => {
        if (!ignore) viewerRef.current?.loadCape(image, { backEquipment: elytra ? 'elytra' : 'cape' })
      })
      .catch(err => {
        if (!ignore) onError?.(err)
      })

    return () => { ignore = true }
  }, [cape, elytra, onError])

  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer) viewer.playerWrapper.rotation.y = showBack ? Math.PI : 0
  }, [showBack])

  return (
    // The canvas is out of the flow (absolute): the box gets its size from the layout and the
    // canvas follows it, never the other way round, or each resize would feed the next.
    <div ref={boxRef} className="relative w-full h-full min-h-0 overflow-hidden cursor-grab active:cursor-grabbing" />
  )
}
