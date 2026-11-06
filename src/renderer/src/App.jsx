import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LaunchProvider } from './contexts/LaunchContext'
import { ServersProvider } from './contexts/ServersContext'
import { StatusProvider } from './contexts/StatusContext'
import LoginSection from './components/auth/LoginSection'
import HomeScreen from './components/home/HomeScreen'
import StatusMessage from './components/common/StatusMessage'
import TitleBar from './components/common/TitleBar'
import AppLogo from './components/common/AppLogo'

function AppContent() {
  const { account, loading } = useAuth()

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-bg-deep font-inter">
        <div className="text-center">
          <h1>
            <AppLogo className="w-[340px] max-w-[70vw] mx-auto" />
          </h1>
          <p className="text-white/30 text-sm tracking-[4px] mt-6">CARGANDO...</p>
        </div>
      </div>
    )
  }

  if (!account) {
    return <LoginSection />
  }

  return (
    <ServersProvider accountUsername={account.username}>
      <HomeScreen />
    </ServersProvider>
  )
}

function App() {
  // StatusProvider is outermost so every other provider can report through it: AuthProvider
  // tells the player why a session ended instead of dropping them on the login screen.
  return (
    <StatusProvider>
      <AuthProvider>
        <LaunchProvider>
          {/* The window is frameless: the title bar takes its row and every screen fills what
              is left, so screens size themselves with h-full, never h-screen. */}
          <div className="w-screen h-screen flex flex-col overflow-hidden bg-bg-deep">
            <TitleBar />

            <div className="relative flex-1 min-h-0">
              <AppContent />

              {/* One host for the whole app: a message raised on the way out of a screen
                  — a failed login, a launch error that logs the player out — is still on
                  screen after the swap, and the settings screen can raise one at all. */}
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 min-w-[300px] pointer-events-none">
                <StatusMessage />
              </div>
            </div>
          </div>
        </LaunchProvider>
      </AuthProvider>
    </StatusProvider>
  )
}

export default App
