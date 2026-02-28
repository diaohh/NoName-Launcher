import { useState } from 'react'
import { useServers } from '../../contexts/ServersContext'
import DynamicBackground from './DynamicBackground'
import ServerSidebar from './ServerSidebar'
import UserProfile from './UserProfile'
import PlayButton from '../launch/PlayButton'
import LaunchOverlay from './LaunchOverlay'
import StatusMessage from '../common/StatusMessage'
import SettingsScreen from '../settings/SettingsScreen'

export default function HomeScreen() {
  const { selectedServer } = useServers()
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
          <h1 className="text-[3.5rem] font-black tracking-[-3px] uppercase font-inter select-none">
            NONAME<span className="text-accent-green animate-blink">_</span>
          </h1>
        )}

        {selectedServer && (
          <p className="text-white/40 text-sm mb-4">
            {selectedServer.description}
          </p>
        )}

        <PlayButton />

        <LaunchOverlay />

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 min-w-[300px]">
          <StatusMessage />
        </div>
      </main>
    </div>
  )
}
