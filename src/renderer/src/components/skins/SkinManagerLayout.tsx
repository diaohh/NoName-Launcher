import type { HTMLAttributes, ReactNode } from 'react'

/**
 * The frame of "Gestor de Skins", shared by the screen and its loading skeleton so the two
 * cannot drift apart: the skeleton is this same frame with placeholders in the slots.
 *
 * It lives outside the lazy chunk (HomeScreen renders the skeleton as the Suspense fallback),
 * so nothing here may import skinview3d, skinview-utils or anything that does.
 */

export const SECONDARY_BUTTON = 'bg-white/5 border border-white/10 rounded px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'

// The way out of the screen: bigger than the rest, with a glow on hover — white for Cancelar,
// the accent for Guardar. A disabled button does not light up.
const FOOTER_BUTTON = 'min-w-[150px] flex items-center justify-center gap-2 rounded-md px-8 py-3 text-sm font-bold tracking-wide transition-all duration-200 cursor-pointer disabled:shadow-none'
export const CANCEL_BUTTON = `${FOOTER_BUTTON} bg-white/[0.06] border border-white/15 text-white/80 hover:bg-white/10 hover:border-white/30 hover:text-white hover:shadow-[0_0_22px_rgba(255,255,255,0.18)] disabled:opacity-50 disabled:cursor-not-allowed`
export const SAVE_BUTTON = `${FOOTER_BUTTON} bg-accent-orange border border-accent-orange text-white hover:brightness-110 hover:shadow-[0_0_26px_color-mix(in_srgb,var(--color-accent-orange)_55%,transparent)] disabled:opacity-70 disabled:cursor-wait`

const SECTION_TITLE = 'text-sm font-semibold text-white/50 uppercase tracking-widest'

/** The thin bar between a section title and the control next to it. */
function TitleSeparator() {
  return <span aria-hidden="true" className="text-white/20">|</span>
}

interface SkinManagerLayoutProps {
  /** The 3D player (or its placeholder). */
  viewer: ReactNode
  /** The model radio buttons. */
  model: ReactNode
  modelDisabled: boolean
  /** Next to the "Skin" title. */
  importControl: ReactNode
  /** Spread on the vault box (role, keyboard handler). */
  vaultProps: HTMLAttributes<HTMLDivElement>
  /** The skin grid. */
  vault: ReactNode
  /** Next to the "Capa" title. */
  elytraControl: ReactNode
  /** The cape row. */
  capes: ReactNode
  /** Cancelar and Guardar. */
  footer: ReactNode
  /** Overlays on top of the whole screen. */
  children?: ReactNode
}

export default function SkinManagerLayout({
  viewer, model, modelDisabled, importControl, vaultProps, vault, elytraControl, capes, footer, children
}: SkinManagerLayoutProps) {
  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden bg-[#1a1a1e] font-inter text-white">
      {/* The margins grow with the window, so a maximised launcher does not leave everything
          pressed against the edges. */}
      <div className="shrink-0 px-[clamp(24px,4vw,64px)] pt-[clamp(20px,4vh,40px)] pb-[clamp(12px,2.5vh,24px)]">
        <h1 className="text-2xl font-black uppercase tracking-[-1px]">Gestor de Skins</h1>
      </div>

      <div className="flex-1 min-h-0 flex gap-[clamp(24px,3vw,48px)] px-[clamp(24px,4vw,64px)] pb-[clamp(20px,4vh,40px)]">
        {/* Left, 40% of the width: the player, and the model it is drawn with. */}
        <div className="w-[40%] shrink-0 flex flex-col gap-4">
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,255,255,0.06)_0%,transparent_70%)]">
            {viewer}
          </div>

          <fieldset disabled={modelDisabled} className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-4 pt-1 pb-3 disabled:opacity-50">
            <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-white/50">Modelo</legend>
            <div className="flex justify-center gap-8">
              {model}
            </div>
          </fieldset>
        </div>

        {/* Right: the vault, the capes, and the way out. */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <section className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="shrink-0 flex items-center gap-3">
              <h2 className={SECTION_TITLE}>Skin</h2>
              <TitleSeparator />
              {importControl}
            </div>

            <div
              {...vaultProps}
              className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 outline-none focus-visible:border-white/25"
            >
              {vault}
            </div>
          </section>

          <section className="shrink-0 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className={SECTION_TITLE}>Capa</h2>
              <TitleSeparator />
              {elytraControl}
            </div>

            <div role="listbox" aria-label="Capas" className="flex gap-3 overflow-x-auto rounded-lg border border-white/10 bg-black/20 p-3">
              {capes}
            </div>
          </section>

          <div className="shrink-0 flex justify-end gap-3">
            {footer}
          </div>
        </div>
      </div>

      {children}
    </div>
  )
}

/** The skin grid's columns, shared with the skeleton so placeholders take the same room. */
export const VAULT_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3 content-start'
