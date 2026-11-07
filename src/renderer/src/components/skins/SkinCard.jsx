import { useRef } from 'react'
import { MAX_SKIN_NAME_LENGTH } from '../../../../shared/skins'

export const CARD = 'relative shrink-0 flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors duration-200 cursor-pointer'
export const IDLE = 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20'
const SELECTED = 'border-accent-orange bg-accent-orange/15'

/** Marks the skin or cape the account is wearing right now, as Mojang has it. */
function InUseBadge() {
  return (
    <span className="absolute top-1 right-1 rounded bg-black/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-white/60">
      En uso
    </span>
  )
}

/**
 * The name, edited in place. Enter and a click elsewhere keep it, Escape keeps the old one,
 * and so does leaving it empty. Committing happens in `onBlur` only, so Enter (which blurs)
 * and the click elsewhere cannot both save it.
 */
function NameInput({ initial, onCommit, onCancel }) {
  const cancelled = useRef(false)

  return (
    <input
      autoFocus
      defaultValue={initial}
      maxLength={MAX_SKIN_NAME_LENGTH}
      aria-label="Nombre de la skin"
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Keys typed into the name must not reach the vault's own shortcuts (Supr deletes).
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        const name = e.target.value.trim()
        if (cancelled.current || !name || name === initial) onCancel()
        else onCommit(name)
      }}
      className="w-full min-w-0 bg-black/40 border border-accent-orange/60 rounded px-1 py-0.5 text-xs text-center text-white outline-none"
    />
  )
}

/**
 * One skin of the vault: its front view and its name. Left click picks it, right click opens
 * the menu with rename and delete.
 */
export function SkinCard({ skin, thumb, selected, inUse, renaming, onSelect, onContextMenu, onRename, onRenameCancel }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      title={skin.name}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu({ x: e.clientX, y: e.clientY })
      }}
      className={`${CARD} ${selected ? SELECTED : IDLE}`}
    >
      {inUse && <InUseBadge />}
      {thumb ? (
        <img
          src={thumb}
          alt=""
          className="h-[72px] w-[36px] mt-1"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <span className="h-[72px] w-[36px] mt-1 rounded-sm bg-white/5" />
      )}
      {renaming ? (
        <NameInput initial={skin.name} onCommit={onRename} onCancel={onRenameCancel} />
      ) : (
        <span className="w-full truncate text-center text-xs text-white/80">{skin.name}</span>
      )}
    </div>
  )
}

/**
 * One option of the cape row. `preview` is the box drawn above the name: the cape's outside,
 * or the empty grey one of "Sin capa".
 */
export function CapeCard({ name, preview, selected, inUse, onSelect }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      title={name}
      onClick={onSelect}
      className={`${CARD} w-[92px] ${selected ? SELECTED : IDLE}`}
    >
      {inUse && <InUseBadge />}
      <span className="block h-[64px] w-[40px] mt-1 rounded-sm overflow-hidden">
        {preview}
      </span>
      <span className="w-full truncate text-center text-xs text-white/80">{name}</span>
    </button>
  )
}
