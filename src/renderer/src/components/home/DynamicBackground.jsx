import { useState } from 'react'

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
 */
export default function DynamicBackground({ bannerUrl }) {
  // url -> 'loaded' | 'failed'
  const [status, setStatus] = useState({})

  const target = bannerUrl && status[bannerUrl] !== 'failed' ? bannerUrl : null
  const loaded = Object.keys(status).filter(url => status[url] === 'loaded')

  const settle = (url, result) => setStatus(prev => ({ ...prev, [url]: result }))

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-linear-to-b from-[#4d4d4d] to-[#1a1a1a]">
      {loaded.map(url => {
        const isTarget = url === target

        return (
          <div
            key={url}
            className={`absolute inset-0 bg-cover bg-center transition-[opacity,scale] duration-[600ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
              isTarget
                ? 'z-10 opacity-100 scale-100'
                // Between banners the outgoing one waits for the incoming one to cover it,
                // so the switch never dips through the gradient. Deselecting fades at once.
                : `opacity-0 scale-[1.03] ${target ? 'delay-[600ms]' : ''}`
            }`}
            style={{ backgroundImage: `url('${url}')` }}
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
