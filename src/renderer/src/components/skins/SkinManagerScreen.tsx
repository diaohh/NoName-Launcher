import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { ipc } from '../../services/ipcClient'
import { errorMessage, isTerminalAuthError } from '../../services/errors'
import { capeFrontStyle, describeSkin } from '../../services/skinTextures'
import { useAuth } from '../../contexts/AuthContext'
import { useStatus } from '../../contexts/StatusContext'
import type { SkinState, SkinVariant, SkinWithTexture } from '../../../../shared/skins'
import SkinViewer from './SkinViewer'
import SkinContextMenu, { type MenuPosition } from './SkinContextMenu'
import { CapeCard, SkinCard } from './SkinCard'
import SkinManagerLayout, { CANCEL_BUTTON, SAVE_BUTTON, SECONDARY_BUTTON, VAULT_GRID } from './SkinManagerLayout'
import SkinManagerSkeleton from './SkinManagerSkeleton'
import Spinner from '../common/Spinner'

const MODELS: readonly { value: SkinVariant, label: string }[] = [
  { value: 'classic', label: 'Clasico' },
  { value: 'slim', label: 'Delgado' }
]

/** A skin of the vault with what the grid adds to it. */
interface PreparedSkin extends SkinWithTexture {
  /** The model its arms were drawn for. */
  detected: SkinVariant
  /** A front view per model; null when the browser could not decode the texture. */
  thumbs: Record<SkinVariant, string> | null
}

/** The profile and the vault as main sent them, with the skins prepared for the grid. */
interface SkinVault extends Omit<SkinState, 'skins'> {
  skins: PreparedSkin[]
}

/**
 * Adds what the grid needs to a skin sent by main: its front views and the model its arms
 * were drawn for. A texture the browser cannot decode keeps its place in the vault, without
 * a preview, rather than taking the whole screen down.
 */
async function prepareSkin(skin: SkinWithTexture): Promise<PreparedSkin> {
  try {
    return { ...skin, ...(await describeSkin(skin.texture)) }
  } catch (err) {
    console.warn(`Could not read skin ${skin.id}:`, err)
    return { ...skin, detected: 'classic', thumbs: null }
  }
}

async function loadSkinState(): Promise<SkinVault> {
  const state = await ipc.skins.getState()
  return { ...state, skins: await Promise.all(state.skins.map(prepareSkin)) }
}

function activeTexture(vault: SkinVault): string | null {
  return vault.skins.find(skin => skin.id === vault.activeSkinId)?.texture ?? null
}

/**
 * "Gestor de Skins": the 3D viewer and the model on the left, the vault and the capes on the
 * right. Importing, renaming and deleting touch the vault on disk at once, like a file
 * explorer, and "Cancelar" does not undo them. The skin, its model and the cape are only a
 * choice until "Guardar" sends them to Mojang.
 */
export default function SkinManagerScreen({ onBack }: { onBack: () => void }) {
  const { logout, updateSkinTexture } = useAuth()
  const { showStatus } = useStatus()

  const [vault, setVault] = useState<SkinVault | null>(null)
  const [failed, setFailed] = useState(false)
  // The player's pending choice; `undefined` means "what the account is wearing now". Kept as
  // overrides on top of the loaded state, so a reload after a failed save keeps it. A cape id
  // of null is a choice too: no cape.
  const [chosenSkinId, setChosenSkinId] = useState<string | undefined>(undefined)
  const [chosenCapeId, setChosenCapeId] = useState<string | null | undefined>(undefined)
  const [variants, setVariants] = useState<Record<string, SkinVariant>>({})
  const [elytra, setElytra] = useState(false)
  const [showBack, setShowBack] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string, position: MenuPosition } | null>(null)

  /** Says what failed, and leaves when the session is gone for good, as JUGAR does. */
  const reportFailure = useCallback(async (err: unknown, fallback: string) => {
    showStatus(errorMessage(err, fallback), 'error')
    if (isTerminalAuthError(err)) await logout()
  }, [showStatus, logout])

  const reportViewerError = useCallback((err: unknown) => {
    console.error('The skin viewer could not load a texture:', err)
    showStatus('No se ha podido mostrar esa textura.', 'error')
  }, [showStatus])

  const closeMenu = useCallback(() => setMenu(null), [])

  // Fetch on mount: the profile and the vault, through main.
  useEffect(() => {
    let ignore = false

    loadSkinState()
      .then(loaded => {
        if (!ignore) setVault(loaded)
      })
      .catch(err => {
        if (ignore) return
        console.error('Failed to load the skin manager:', err)
        setFailed(true)
        reportFailure(err, 'No se ha podido cargar el gestor de skins')
      })

    return () => { ignore = true }
  }, [reportFailure])

  const retry = async () => {
    setFailed(false)
    try {
      setVault(await loadSkinState())
    } catch (err) {
      setFailed(true)
      reportFailure(err, 'No se ha podido cargar el gestor de skins')
    }
  }

  // The same skeleton HomeScreen shows while this chunk loads, so loading reads as one step.
  if (!vault) {
    return <SkinManagerSkeleton onCancel={onBack} failed={failed} onRetry={retry} />
  }

  // What the screen shows is the account's current state with the player's choice on top.
  const skin = vault.skins.find(s => s.id === chosenSkinId)
    ?? vault.skins.find(s => s.id === vault.activeSkinId)
    ?? null
  const variantOf = (s: PreparedSkin) => variants[s.id] ?? s.variant ?? s.detected
  const variant = skin ? variantOf(skin) : vault.activeVariant
  const capeId = chosenCapeId !== undefined ? chosenCapeId : vault.activeCapeId
  const cape = vault.capes.find(c => c.id === capeId) ?? null
  const dirty = (skin != null && (skin.id !== vault.activeSkinId || variant !== vault.activeVariant))
    || capeId !== vault.activeCapeId

  const setSkinName = (id: string, name: string) => {
    setVault(v => v && { ...v, skins: v.skins.map(s => (s.id === id ? { ...s, name } : s)) })
  }

  const selectSkin = (id: string) => {
    setChosenSkinId(id)
    setShowBack(false)
  }

  const selectCape = (id: string | null) => {
    setChosenCapeId(id)
    setShowBack(true)
  }

  const importSkin = async () => {
    setImporting(true)
    try {
      const result = await ipc.skins.import()
      if (!result) return

      const prepared = await prepareSkin(result.skin)
      setVault(v => v && (v.skins.some(s => s.id === prepared.id) ? v : { ...v, skins: [...v.skins, prepared] }))
      selectSkin(prepared.id)
      if (result.duplicate) showStatus('Esa skin ya estaba guardada.', 'info')
    } catch (err) {
      showStatus(errorMessage(err, 'No se ha podido importar la skin'), 'error')
    } finally {
      setImporting(false)
    }
  }

  const renameSkin = async (id: string, name: string) => {
    setRenamingId(null)
    const previous = vault.skins.find(s => s.id === id)?.name
    setSkinName(id, name)

    try {
      const saved = await ipc.skins.rename(id, name)
      setSkinName(id, saved.name)
    } catch (err) {
      if (previous !== undefined) setSkinName(id, previous)
      showStatus(errorMessage(err, 'No se ha podido renombrar la skin'), 'error')
    }
  }

  const deleteSkin = async (id: string) => {
    try {
      await ipc.skins.delete(id)
      // A chosen skin that is gone falls back to the one being worn on its own: `skin` above
      // only honours a choice that is still in the vault.
      setVault(v => v && { ...v, skins: v.skins.filter(s => s.id !== id) })
      showStatus('Skin enviada a la papelera.', 'info')
    } catch (err) {
      showStatus(errorMessage(err, 'No se ha podido borrar la skin'), 'error')
    }
  }

  // F2 and Supr act on the selected skin, as in a file explorer. The name input stops its own
  // keys, so typing in it never reaches here.
  const handleVaultKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!skin) return
    if (e.key === 'F2') {
      e.preventDefault()
      setRenamingId(skin.id)
    } else if (e.key === 'Delete' && skin.id !== vault.activeSkinId) {
      e.preventDefault()
      deleteSkin(skin.id)
    }
  }

  const save = async () => {
    if (!dirty) {
      onBack()
      return
    }

    setSaving(true)
    try {
      const { skinTexture } = await ipc.skins.save({ skinId: skin?.id ?? null, variant, capeId })
      updateSkinTexture(skinTexture)
      showStatus('Cambios guardados.', 'success')
      onBack()
    } catch (err) {
      setSaving(false)
      await reportFailure(err, 'No se han podido guardar los cambios')
      if (isTerminalAuthError(err)) return

      // Part of it may have stuck — the skin, before the cape was refused. Reading the
      // profile again shows what did; the player's choice stays on top of it.
      try {
        const loaded = await loadSkinState()
        setVault(loaded)
        updateSkinTexture(activeTexture(loaded))
      } catch (reloadErr) {
        console.warn('Could not re-read the profile after a failed save:', reloadErr)
      }
    }
  }

  const menuSkin = menu && vault.skins.find(s => s.id === menu.id)

  return (
    <SkinManagerLayout
      viewer={
        <SkinViewer
          skin={skin?.texture ?? vault.fallbackSkin}
          variant={variant}
          cape={cape?.texture ?? null}
          elytra={elytra}
          showBack={showBack}
          onError={reportViewerError}
        />
      }
      modelDisabled={!skin}
      model={MODELS.map(model => (
        <label key={model.value} className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
          <input
            type="radio"
            name="skin-model"
            value={model.value}
            checked={variant === model.value}
            onChange={() => { if (skin) setVariants(v => ({ ...v, [skin.id]: model.value })) }}
            className="w-4 h-4 accent-accent-orange cursor-pointer"
          />
          {model.label}
        </label>
      ))}
      importControl={
        <button onClick={importSkin} disabled={importing || saving} className={`${SECONDARY_BUTTON} py-1.5 text-xs`}>
          Importar skin desde imagen
        </button>
      }
      vaultProps={{
        role: 'listbox',
        'aria-label': 'Skins guardadas',
        tabIndex: 0,
        onKeyDown: handleVaultKeys
      }}
      vault={vault.skins.length === 0 ? (
        <p className="h-full flex items-center justify-center text-sm text-white/30">
          Importa una skin para empezar.
        </p>
      ) : (
        <div className={VAULT_GRID}>
          {vault.skins.map(s => (
            <SkinCard
              key={s.id}
              skin={s}
              thumb={s.thumbs?.[variantOf(s)]}
              selected={s.id === skin?.id}
              inUse={s.id === vault.activeSkinId}
              renaming={s.id === renamingId}
              onSelect={() => selectSkin(s.id)}
              onContextMenu={(position) => setMenu({ id: s.id, position })}
              onRename={(name) => renameSkin(s.id, name)}
              onRenameCancel={() => setRenamingId(null)}
            />
          ))}
        </div>
      )}
      elytraControl={
        <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
          <input
            type="checkbox"
            checked={elytra}
            onChange={(e) => {
              setElytra(e.target.checked)
              setShowBack(true)
            }}
            className="w-4 h-4 accent-accent-orange cursor-pointer"
          />
          Ver en Elytra
        </label>
      }
      capes={
        <>
          <CapeCard
            name="Sin capa"
            preview={<span className="block w-full h-full bg-white/10" />}
            selected={capeId === null}
            inUse={vault.activeCapeId === null}
            onSelect={() => selectCape(null)}
          />
          {vault.capes.map(c => (
            <CapeCard
              key={c.id}
              name={c.name}
              preview={c.texture
                ? <span className="block w-full h-full" style={capeFrontStyle(c.texture)} />
                : <span className="block w-full h-full bg-white/5" />}
              selected={c.id === capeId}
              inUse={c.id === vault.activeCapeId}
              onSelect={() => selectCape(c.id)}
            />
          ))}
          {vault.capes.length === 0 && (
            <p className="self-center pl-2 text-xs text-white/30">Tu cuenta no tiene capas.</p>
          )}
        </>
      }
      footer={
        <>
          <button onClick={onBack} disabled={saving} className={CANCEL_BUTTON}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className={SAVE_BUTTON}>
            {saving && <Spinner />}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      {menu && menuSkin && (
        <SkinContextMenu
          position={menu.position}
          canDelete={menuSkin.id !== vault.activeSkinId}
          onRename={() => setRenamingId(menuSkin.id)}
          onDelete={() => deleteSkin(menuSkin.id)}
          onClose={closeMenu}
        />
      )}
    </SkinManagerLayout>
  )
}
