import { useState } from 'react'

type BannerStatus = 'loaded' | 'failed'

/**
 * Crossfades between modpack banners over a fixed grey gradient.
 *
 * The gradient is what the screen shows with no modpack selected. It reproduces the old
 * look, which was a 70-90% black veil over the white window: the stock photo it was meant
 * to dim had been a dead link all along, so the veil was all anyone ever saw.
 *
 * Every banner that has loaded keeps a layer, and which one is visible is derived from the
 * prop: switching modpacks, or deselecting one, is a CSS transition rather than a state
 * change. A banner is only loaded through a hidden <img> while it is the one selected, so a
 * slow image that finishes after the player moved on never becomes visible.
 *
 * Each layer is an <img> with `object-cover`, not a CSS `background-image`. The URL comes from
 * Firestore, and interpolating it into `url('…')` let a quote in it break out of the value;
 * as an attribute it is never parsed as CSS at all.
 */
export default function DynamicBackground({ bannerUrl }: { bannerUrl: string | undefined }) {
  const [status, setStatus] = useState<Record<string, BannerStatus>>({})

  const target = bannerUrl && status[bannerUrl] !== 'failed' ? bannerUrl : null
  const loaded = Object.keys(status).filter(url => status[url] === 'loaded')

  const settle = (url: string, result: BannerStatus) => setStatus(prev => ({ ...prev, [url]: result }))

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-linear-to-b from-[#4d4d4d] to-[#1a1a1a]">
      {loaded.map(url => {
        const isTarget = url === target

        return (
          <img
            key={url}
            src={url}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover object-center transition-[opacity,scale] duration-[600ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
              isTarget
                ? 'z-10 opacity-100 scale-100'
                // Between banners the outgoing one waits for the incoming one to cover it,
                // so the switch never dips through the gradient. Deselecting fades at once.
                : `opacity-0 scale-[1.03] ${target ? 'delay-[600ms]' : ''}`
            }`}
          />
        )
      })}

      {target && !status[target] && (
        <img
          key={target}
          src={target}
          alt=""
          hidden
          onLoad={() => settle(target, 'loaded')}
          onError={() => settle(target, 'failed')}
        />
      )}
    </div>
  )
}
