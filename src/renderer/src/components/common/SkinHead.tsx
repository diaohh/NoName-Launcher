import type { CSSProperties } from 'react'

/**
 * Inline style that shows one layer of the front of the head in a square of `size` px: the
 * face at (8,8) or the hat at (40,8) of the skin texture. Pure CSS, so the avatar needs no
 * canvas and no effect. The rows the head lives in are the same in 64x64 and 64x32
 * textures, so an `auto` height fits both.
 *
 * Kept here rather than in services/skinTextures, which imports skinview-utils: the avatar is
 * on the home screen, and that library belongs to the skin manager's lazy chunk.
 */
function headLayerStyle(texture: string, size: number, column: number): CSSProperties {
  return {
    width: size,
    height: size,
    backgroundImage: `url("${texture}")`,
    backgroundSize: `${size * 8}px auto`,
    backgroundPosition: `${-column * size}px ${-size}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated'
  }
}

interface SkinHeadProps {
  /** Skin texture as a data URL. */
  texture: string
  /** Side of the square, in px. A multiple of 8 keeps the pixels crisp. */
  size: number
  className?: string
}

/**
 * The front of a player's head, drawn from their skin texture: the face, then the hat layer
 * over it. Replaces the minotar.net avatar, which a third party cached for a while after
 * every skin change; the texture is the one the launcher already has, so it changes the
 * moment the skin does.
 */
export default function SkinHead({ texture, size, className = '' }: SkinHeadProps) {
  return (
    <span className={`relative block ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute inset-0" style={headLayerStyle(texture, size, 1)} />
      <span className="absolute inset-0" style={headLayerStyle(texture, size, 5)} />
    </span>
  )
}
