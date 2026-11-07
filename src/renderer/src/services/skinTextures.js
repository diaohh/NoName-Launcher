import { inferModelType, loadSkinToCanvas } from 'skinview-utils'

/**
 * Skin textures arrive from main as data URLs: the account's own from Mojang, the rest from
 * the vault. Everything here works on those, in the renderer, with a 2D canvas — the 3D
 * viewer is a single WebGL context, and one per thumbnail would exhaust Chromium's limit.
 */

export async function loadImage(dataUrl) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return image
}

/**
 * Where each front face sits in a 64x64 skin and where it goes in a 16x32 front view.
 * `w` null means "the arm width", 4 for classic and 3 for slim. Base layers first, then the
 * overlays (hat, jacket, sleeves, trousers) on top of them.
 */
const FRONT_FACES = [
  // head, body, legs
  { sx: 8, sy: 8, w: 8, h: 8, dx: 4, dy: 0 },
  { sx: 20, sy: 20, w: 8, h: 12, dx: 4, dy: 8 },
  { sx: 4, sy: 20, w: 4, h: 12, dx: 4, dy: 20 },
  { sx: 20, sy: 52, w: 4, h: 12, dx: 8, dy: 20 },
  // arms: the player's right arm is on the viewer's left, flush against the body
  { sx: 44, sy: 20, w: null, h: 12, dx: 'right', dy: 8 },
  { sx: 36, sy: 52, w: null, h: 12, dx: 12, dy: 8 },
  // overlays
  { sx: 40, sy: 8, w: 8, h: 8, dx: 4, dy: 0 },
  { sx: 20, sy: 36, w: 8, h: 12, dx: 4, dy: 8 },
  { sx: 4, sy: 36, w: 4, h: 12, dx: 4, dy: 20 },
  { sx: 4, sy: 52, w: 4, h: 12, dx: 8, dy: 20 },
  { sx: 44, sy: 36, w: null, h: 12, dx: 'right', dy: 8 },
  { sx: 52, sy: 52, w: null, h: 12, dx: 12, dy: 8 }
]

function renderFront(skinCanvas, variant) {
  const armWidth = variant === 'slim' ? 3 : 4
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 32
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = false

  for (const face of FRONT_FACES) {
    const w = face.w ?? armWidth
    const dx = face.dx === 'right' ? 4 - w : face.dx
    context.drawImage(skinCanvas, face.sx, face.sy, w, face.h, dx, face.dy, w, face.h)
  }

  return canvas.toDataURL('image/png')
}

/**
 * Everything the vault grid needs from a texture: the model the texture was drawn for (3 px
 * arms are slim), and a front view for each model, so switching the radio buttons updates
 * the thumbnail without decoding the texture again. 64x32 skins are converted to the 64x64
 * layout first by skinview-utils.
 *
 * @returns {Promise<{ detected: 'classic'|'slim', thumbs: { classic: string, slim: string } }>}
 */
export async function describeSkin(dataUrl) {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  loadSkinToCanvas(canvas, image)

  return {
    detected: inferModelType(canvas) === 'slim' ? 'slim' : 'classic',
    thumbs: {
      classic: renderFront(canvas, 'classic'),
      slim: renderFront(canvas, 'slim')
    }
  }
}

/**
 * Inline style that shows the outside of a cape — the 10x16 face at (1,1) of its 64x32
 * texture — filling its box. Percentages, so it holds for any box with that 10:16 ratio and
 * for HD textures with the same layout.
 */
export function capeFrontStyle(texture) {
  return {
    backgroundImage: `url("${texture}")`,
    // The texture is 6.4 faces wide and 2 faces tall.
    backgroundSize: '640% 200%',
    // A percentage offset is p * (box - image): -1/64 of the width is 0.1 box widths, which
    // is 0.1 / 5.4 of the travel; -1/32 of the height is 1/16 of the travel.
    backgroundPosition: `${(0.1 / 5.4) * 100}% ${100 / 16}%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated'
  }
}
