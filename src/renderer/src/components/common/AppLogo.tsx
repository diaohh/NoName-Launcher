import logo from '../../assets/imgs/nonamelauncher-logo.png'

/**
 * The launcher's logo: the raccoon and the "NONAME LAUNCHER" wordmark, white on transparent.
 * Size it with a width in `className`; the height follows the image (about 4.2:1).
 */
export default function AppLogo({ className = '' }: { className?: string }) {
  return (
    <img
      src={logo}
      alt="NoName Launcher"
      draggable={false}
      className={`block h-auto select-none ${className}`}
    />
  )
}
