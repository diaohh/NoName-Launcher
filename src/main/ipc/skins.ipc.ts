import { dialog, type BrowserWindow } from 'electron'
import { Channels } from '../../shared/channels'
import { ERROR_CODE } from '../../shared/errorCodes'
import { LauncherError } from '../../shared/LauncherError'
import type { InvokeHandlers } from './result'
import { isPlainObject, isSkinId, type SkinId } from '../../shared/guards'
import { isSkinVariant } from '../../shared/skins'
import SkinManager, { cleanSkinName, type CheckedSaveChoice } from '../managers/SkinManager'

/**
 * Everything below arrives from the renderer. Ids are checked for shape here and for
 * existence in SkinManager; a path never comes from this side at all — the import takes it
 * from the native dialog, the way `logs:export` does.
 */
function invalidValue(message: string): LauncherError {
  return new LauncherError(ERROR_CODE.SKIN_INVALID_VALUE, message)
}

function requireSkinId(value: unknown): SkinId {
  if (!isSkinId(value)) throw invalidValue('Skin no valida.')
  return value
}

function requireSaveChoice(raw: unknown): CheckedSaveChoice {
  if (!isPlainObject(raw)) throw invalidValue('No hay nada que guardar.')

  const skinId = raw.skinId === null ? null : requireSkinId(raw.skinId)
  const { variant, capeId } = raw
  if (!isSkinVariant(variant)) throw invalidValue('El modelo debe ser clasico o delgado.')
  if (capeId !== null && (typeof capeId !== 'string' || capeId.length === 0 || capeId.length > 64)) {
    throw invalidValue('Capa no valida.')
  }

  return { skinId, variant, capeId }
}

export function skinsHandlers(mainWindow: BrowserWindow) {
  return {
    [Channels.SKINS_GET_STATE]: async () => {
      return await SkinManager.getState()
    },

    [Channels.SKINS_GET_ACTIVE_TEXTURE]: async () => {
      return await SkinManager.getActiveTexture()
    },

    /** One PNG at a time. Null when the player closes the dialog without picking one. */
    [Channels.SKINS_IMPORT]: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Importar skin',
        filters: [{ name: 'Skin de Minecraft (PNG)', extensions: ['png'] }],
        properties: ['openFile']
      })
      if (canceled || !filePaths[0]) return null

      return await SkinManager.importSkinFile(filePaths[0])
    },

    [Channels.SKINS_RENAME]: async (_event, id, name) => {
      const cleaned = cleanSkinName(name)
      if (!cleaned) throw invalidValue('El nombre de la skin no puede estar vacio.')
      return await SkinManager.renameSkin(requireSkinId(id), cleaned)
    },

    [Channels.SKINS_DELETE]: async (_event, id) => {
      await SkinManager.deleteSkin(requireSkinId(id))
    },

    [Channels.SKINS_SAVE]: async (_event, choice) => {
      return await SkinManager.save(requireSaveChoice(choice))
    }
  } satisfies Partial<InvokeHandlers>
}
