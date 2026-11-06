import { useState } from 'react'

/**
 * The modpack's title artwork, kept apart from the banner so it is always centred on the
 * play button: the banner is centred on the whole window and cropped by `bg-cover`, the
 * logo on the area right of the sidebar and never cropped.
 *
 * Mount it with `key={url}` so the loaded/failed state starts over for each modpack.
 * A logo that fails to load shows nothing rather than a broken image.
 *
 * It is a flex item in HomeScreen's column, in the box that takes whatever height the play
 * button and the launch tracker leave: `min-h-0` lets it shrink below its natural height and
 * `object-contain` scales the artwork down inside it, so the logo always fills the free space
 * and can never reach the button. It used to be capped with a height computed from the
 * button's fixed offset, which pinned it to 110px in the default 1000x600 window. 55vh only
 * stops a square logo from taking over a tall screen.
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
      className={`mb-3 min-h-0 w-[min(75%,1000px)] h-auto max-h-[55vh] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] ${
        loaded ? 'animate-fade-in-up motion-reduce:animate-none' : 'opacity-0'
      }`}
    />
  )
}
