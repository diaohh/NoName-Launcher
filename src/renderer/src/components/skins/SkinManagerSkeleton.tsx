import Spinner from '../common/Spinner'
import SkinManagerLayout, { CANCEL_BUTTON, SAVE_BUTTON, SECONDARY_BUTTON, VAULT_GRID } from './SkinManagerLayout'
import { CARD, IDLE } from './SkinCard'

const PLACEHOLDER_SKINS = 6
const PLACEHOLDER_CAPES = 2

const MODEL_LABELS = ['Clasico', 'Delgado']

interface SkinManagerSkeletonProps {
  onCancel: () => void
  failed?: boolean
  /** Required when `failed`. */
  onRetry?: () => void
}

/** A grey block where data will be; it pulses while loading and stays still once it failed. */
function Placeholder({ pulse, className }: { pulse: boolean, className: string }) {
  return <span className={`block rounded bg-white/[0.07] ${pulse ? 'animate-pulse motion-reduce:animate-none' : ''} ${className}`} />
}

/**
 * The skin manager before its data arrives: the real frame, the fixed text and controls as
 * they will be (disabled), grey blocks where the player, the skins and the capes go, and a
 * small dialog in the middle that says it is loading and offers the way out.
 *
 * It is both HomeScreen's Suspense fallback, while the lazy chunk is read, and the screen's
 * own loading state, while main reads the profile — one continuous skeleton, not two. When the
 * load fails the blocks stop pulsing and the dialog offers to retry instead.
 */
export default function SkinManagerSkeleton({ onCancel, failed = false, onRetry }: SkinManagerSkeletonProps) {
  const pulse = !failed

  return (
    <SkinManagerLayout
      viewer={
        <div className="w-full h-full flex items-center justify-center">
          <Placeholder pulse={pulse} className="w-[30%] h-[70%] rounded-lg" />
        </div>
      }
      modelDisabled
      model={MODEL_LABELS.map(label => (
        <label key={label} className="flex items-center gap-2 text-sm text-white/80">
          <input type="radio" disabled className="w-4 h-4" />
          {label}
        </label>
      ))}
      importControl={
        <button disabled className={`${SECONDARY_BUTTON} py-1.5 text-xs`}>Importar skin desde imagen</button>
      }
      vaultProps={{ 'aria-busy': pulse }}
      vault={
        <div className={VAULT_GRID}>
          {Array.from({ length: PLACEHOLDER_SKINS }, (_, i) => (
            <div key={i} className={`${CARD} ${IDLE} pointer-events-none`}>
              <Placeholder pulse={pulse} className="h-[72px] w-[36px] mt-1" />
              <Placeholder pulse={pulse} className="h-[16px] w-3/4" />
            </div>
          ))}
        </div>
      }
      elytraControl={
        <label className="flex items-center gap-2 text-xs text-white/40">
          <input type="checkbox" disabled className="w-4 h-4" />
          Ver en Elytra
        </label>
      }
      capes={Array.from({ length: PLACEHOLDER_CAPES + 1 }, (_, i) => (
        <div key={i} className={`${CARD} ${IDLE} w-[92px] pointer-events-none`}>
          <Placeholder pulse={pulse} className="h-[64px] w-[40px] mt-1 rounded-sm" />
          <Placeholder pulse={pulse} className="h-[16px] w-3/4" />
        </div>
      ))}
      footer={
        <>
          <button disabled className={CANCEL_BUTTON}>Cancelar</button>
          <button disabled className={SAVE_BUTTON}>Guardar</button>
        </>
      }
    >
      {/* Only dimmed, not blurred: the blur belongs to the panel, which would otherwise blur a
          flat wash (the same rule as the common Modal). Kept inside the screen rather than in a
          portal, so the title bar above stays usable. */}
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/25">
        <div
          role={failed ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-label={failed ? 'Error al cargar el gestor de skins' : 'Cargando el gestor de skins'}
          className="flex flex-col items-center gap-5 rounded-xl border border-white/10 bg-[rgba(18,18,20,0.55)] backdrop-blur-[28px] backdrop-saturate-150 px-8 py-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        >
          {failed ? (
            <p className="max-w-[280px] text-center text-sm text-white/70">No se ha podido cargar el gestor de skins.</p>
          ) : (
            <p role="status" className="flex items-center gap-3 text-sm text-white/80">
              <Spinner />
              Cargando...
            </p>
          )}

          <div className="flex gap-3">
            {failed ? (
              <>
                <button onClick={onCancel} className={CANCEL_BUTTON}>Volver</button>
                <button onClick={onRetry} className={SAVE_BUTTON}>Reintentar</button>
              </>
            ) : (
              <button onClick={onCancel} className={CANCEL_BUTTON}>Cancelar</button>
            )}
          </div>
        </div>
      </div>
    </SkinManagerLayout>
  )
}
