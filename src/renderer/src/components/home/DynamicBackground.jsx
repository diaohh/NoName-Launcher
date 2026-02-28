import { useState, useEffect } from 'react'

const DEFAULT_BG = 'https://images.unsplash.com/photo-1623934199716-dc3582023a97?q=80&w=1920&auto=format&fit=crop'

export default function DynamicBackground({ bannerUrl }) {
  const [currentBg, setCurrentBg] = useState(DEFAULT_BG)

  useEffect(() => {
    const newBg = bannerUrl || DEFAULT_BG
    if (newBg !== currentBg) {
      const img = new Image()
      img.onload = () => setCurrentBg(newBg)
      img.onerror = () => setCurrentBg(DEFAULT_BG)
      img.src = newBg
    }
  }, [bannerUrl])

  return (
    <div
      className="fixed inset-0 z-0 bg-cover bg-center transition-all duration-[800ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.9)), url('${currentBg}')`
      }}
    />
  )
}
