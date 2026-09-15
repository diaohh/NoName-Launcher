import { useState } from 'react'
import { useServers } from '../../contexts/ServersContext'
import DynamicBackground from './DynamicBackground'
import ModpackLogo from './ModpackLogo'
import ServerSidebar from './ServerSidebar'
import UserProfile from './UserProfile'
import PlayButton from '../launch/PlayButton'
import LaunchOverlay from './LaunchOverlay'
import ServersError from './ServersError'
import SettingsScreen from '../settings/SettingsScreen'

export default function HomeScreen() {
  const { selectedServer, error, reload } = useServers()
  const [showSettings, setShowSettings] = useState(false)

  if (showSettings) {
    return <SettingsScreen onBack={() => setShowSettings(false)} />
  }

  return (
    <div className="w-screen h-screen flex overflow-hidden font-inter text-white">
      <DynamicBackground bannerUrl={selectedServer?.banner} />

      <ServerSidebar />

      <main className="flex-1 flex flex-col items-center justify-center relative">
        <UserProfile onOpenSettings={() => setShowSettings(true)} />

        {!selectedServer && (
          error
            ? <ServersError error={error} onRetry={reload} />
            : (
              <h1 className="text-[3.5rem] font-black tracking-[-3px] uppercase font-inter select-none">
                NONAME<span className="text-accent-green animate-blink">_</span>
              </h1>
            )
        )}

        {/* Centred in <main>, the same box the play button is centred in, so logo and button
            share a vertical axis. ModpackLogo caps its own height so this stack never reaches
            the button. */}
        {selectedServer && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 pointer-events-none">
            {selectedServer.logo && (
              <ModpackLogo key={selectedServer.logo} url={selectedServer.logo} name={selectedServer.name} />
            )}
            <p className="text-white/40 text-sm text-center text-shadow-[0_1px_3px_rgb(0_0_0/0.8)]">
              {selectedServer.description}
            </p>
          </div>
        )}

        <PlayButton />

        <LaunchOverlay />
      </main>
    </div>
  )
}
