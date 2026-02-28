export default function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`
        w-11 h-6 rounded-full relative transition-colors duration-200 cursor-pointer border-none shrink-0
        ${checked ? 'bg-accent-green' : 'bg-white/10'}
      `}
    >
      <span
        className={`
          absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200
          ${checked ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  )
}
