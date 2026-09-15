import { useState } from 'react'

/**
 * The modpack's title artwork, kept apart from the banner so it is always centred on the
 * play button: the banner is centred on the whole window and cropped by `bg-cover`, the
 * logo on the area right of the sidebar and never cropped.
 *
 * Mount it with `key={url}` so the loaded/failed state starts over for each modpack.
 * A logo that fails to load shows nothing rather than a broken image.
 *
 * The height cap keeps the vertically centred stack (logo, mb-3, one line of description)
 * clear of the play button, whose top sits 213px above the bottom edge:
 * logo + 32px <= 100vh - 2 * (213px + 12px gap), hence 100vh - 490px. The 110px floor is
 * what that yields at the default 600px window; 55vh stops it growing without bound.
 */
export default function ModpackLogo({ url, name }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (failed) return null

  return (
    <img
      src={url}
      alt={name}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`mb-3 w-[min(75%,1000px)] h-auto max-h-[clamp(110px,calc(100vh-490px),55vh)] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] ${
        loaded ? 'animate-fade-in-up motion-reduce:animate-none' : 'opacity-0'
      }`}
    />
  )
}
