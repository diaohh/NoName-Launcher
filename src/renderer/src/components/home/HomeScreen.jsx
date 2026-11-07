import { lazy, Suspense, useState } from 'react'
import { useServers } from '../../contexts/ServersContext'
import DynamicBackground from './DynamicBackground'
import ModpackLogo from './ModpackLogo'
import ServerSidebar from './ServerSidebar'
import UserProfile from './UserProfile'
import PlayButton from '../launch/PlayButton'
import ProgressBar from '../launch/ProgressBar'
import LogViewer from '../launch/LogViewer'
import ServersError from './ServersError'
import SettingsScreen from '../settings/SettingsScreen'
import AppLogo from '../common/AppLogo'
import SkinManagerSkeleton from '../skins/SkinManagerSkeleton'

// The skin manager carries skinview3d and three.js, a few hundred KB the launcher does not
// need until the player opens it, so it is a chunk of its own, loaded on demand.
const SkinManagerScreen = lazy(() => import('../skins/SkinManagerScreen'))

export default function HomeScreen() {
  const { selectedServer, error, reload } = useServers()
  // 'home', 'settings' or 'skins'. The other screens replace this one whole and come back
  // through `onBack`.
  const [screen, setScreen] = useState('home')
  const goHome = () => setScreen('home')

  if (screen === 'settings') {
    return <SettingsScreen onBack={goHome} />
  }

  if (screen === 'skins') {
    return (
      // The skeleton is outside the lazy chunk and is also what the screen shows while main
      // reads the profile, so opening the skin manager is one continuous loading state.
      <Suspense fallback={<SkinManagerSkeleton onCancel={goHome} />}>
        <SkinManagerScreen onBack={goHome} />
      </Suspense>
    )
  }

  return (
    <div className="w-full h-full flex overflow-hidden font-inter text-white">
      <DynamicBackground bannerUrl={selectedServer?.banner} />

      <ServerSidebar />

      <main className="flex-1 min-w-0 flex flex-col relative">
        <UserProfile
          onOpenSkins={() => setScreen('skins')}
          onOpenSettings={() => setScreen('settings')}
        />

        {selectedServer ? (
          // One column, top to bottom: the logo takes whatever height is left, then the play
          // button, then a slot the launch tracker appears in. Everything is in the flow, so
          // nothing can overlap at any window size, and the slot keeps its height while empty
          // so pressing JUGAR does not shrink the logo under the player's eyes.
          //
          // `--accent` is the modpack's optional `accentColor` (validated in firestoreService)
          // or the launcher's orange, shared by JUGAR and the tracker. It arrives at runtime, so
          // it cannot be a Tailwind class — those are generated at build time — and goes in as a
          // CSS variable that both read.
          <div
            style={{ '--accent': selectedServer.accentColor ?? 'var(--color-accent-orange)' }}
            className="w-full h-full flex flex-col items-center gap-3 px-8 pt-6 pb-[clamp(16px,3vh,40px)]"
          >
            <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center">
              {selectedServer.logo && (
                <ModpackLogo key={selectedServer.logo} url={selectedServer.logo} name={selectedServer.name} />
              )}
              <p className="shrink-0 text-white/40 text-sm text-center text-shadow-[0_1px_3px_rgb(0_0_0/0.8)]">
                {selectedServer.description}
              </p>
            </div>

            <PlayButton />

            <div className="shrink-0 w-[min(560px,100%)] h-[112px]">
              <ProgressBar />
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {error
              ? <ServersError error={error} onRetry={reload} />
              : (
                <h1 className="w-full">
                  <AppLogo className="w-[380px] max-w-[70%] mx-auto" />
                </h1>
              )}
          </div>
        )}

        {/* Out of the column, in the corner next to the sidebar: the logs are for when
            something goes wrong, and should not take room from the logo or the tracker. */}
        <div className="absolute bottom-4 left-4 z-20">
          <LogViewer />
        </div>
      </main>
    </div>
  )
}
