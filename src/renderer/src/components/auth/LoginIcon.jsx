/** The Microsoft logo (four squares in the official colours) for the sign-in button. */
export default function LoginIcon({ size = 20, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect x="0" y="0" width="10" height="10" fill="#f25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7fba00" />
      <rect x="0" y="11" width="10" height="10" fill="#00a4ef" />
      <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
    </svg>
  )
}
