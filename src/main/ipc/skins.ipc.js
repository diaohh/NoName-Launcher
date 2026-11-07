import { dialog } from 'electron'
import { Channels } from '../../shared/channels'
import { ERROR_CODE } from '../../shared/errorCodes'
import { handle } from './result'
import { SKIN_VARIANTS } from '../../shared/skins'
import SkinManager, { cleanSkinName } from '../managers/SkinManager'

const SKIN_ID = /^[0-9a-f]{64}$/

/**
 * Everything below arrives from the renderer. Ids are checked for shape here and for
 * existence in SkinManager; a path never comes from this side at all — the import takes it
 * from the native dialog, the way `logs:export` does.
 */
function invalidValue(message) {
  const error = new Error(message)
  error.code = ERROR_CODE.SKIN_INVALID_VALUE
  return error
}

function requireSkinId(value) {
  if (typeof value !== 'string' || !SKIN_ID.test(value)) throw invalidValue('Skin no valida.')
  return value
}

function requireSaveChoice(choice) {
  if (choice == null || typeof choice !== 'object') throw invalidValue('No hay nada que guardar.')

  const { skinId, variant, capeId } = choice
  if (skinId !== null) requireSkinId(skinId)
  if (!SKIN_VARIANTS.includes(variant)) throw invalidValue('El modelo debe ser clasico o delgado.')
  if (capeId !== null && (typeof capeId !== 'string' || capeId.length === 0 || capeId.length > 64)) {
    throw invalidValue('Capa no valida.')
  }

  return { skinId, variant, capeId }
}

export function registerSkinsIPC(mainWindow) {
  handle(Channels.SKINS_GET_STATE, async () => {
    return await SkinManager.getState()
  })

  handle(Channels.SKINS_GET_ACTIVE_TEXTURE, async () => {
    return await SkinManager.getActiveTexture()
  })

  /** One PNG at a time. Null when the player closes the dialog without picking one. */
  handle(Channels.SKINS_IMPORT, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar skin',
      filters: [{ name: 'Skin de Minecraft (PNG)', extensions: ['png'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null

    return await SkinManager.importSkinFile(filePaths[0])
  })

  handle(Channels.SKINS_RENAME, async (_event, id, name) => {
    const cleaned = cleanSkinName(name)
    if (!cleaned) throw invalidValue('El nombre de la skin no puede estar vacio.')
    return await SkinManager.renameSkin(requireSkinId(id), cleaned)
  })

  handle(Channels.SKINS_DELETE, async (_event, id) => {
    await SkinManager.deleteSkin(requireSkinId(id))
  })

  handle(Channels.SKINS_SAVE, async (_event, choice) => {
    return await SkinManager.save(requireSaveChoice(choice))
  })
}
