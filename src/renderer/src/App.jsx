import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LaunchProvider } from './contexts/LaunchContext'
import { ServersProvider } from './contexts/ServersContext'
import { StatusProvider } from './contexts/StatusContext'
import LoginSection from './components/auth/LoginSection'
import HomeScreen from './components/home/HomeScreen'
import StatusMessage from './components/common/StatusMessage'

function AppContent() {
  const { account, loading } = useAuth()

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-bg-deep font-inter">
        <div className="text-center">
          <h1 className="text-[3.5rem] font-black tracking-[-3px] uppercase text-white">
            NONAME<span className="text-accent-green animate-blink">_</span>
          </h1>
          <p className="text-white/30 text-sm tracking-[4px] mt-2">CARGANDO...</p>
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
  return (
    <AuthProvider>
      <LaunchProvider>
        <StatusProvider>
          <div className="relative w-screen h-screen">
            <AppContent />

            {/* One host for the whole app: a message raised on the way out of a screen
                — a failed login, a launch error that logs the player out — is still on
                screen after the swap, and the settings screen can raise one at all. */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 min-w-[300px] pointer-events-none">
              <StatusMessage />
            </div>
          </div>
        </StatusProvider>
      </LaunchProvider>
    </AuthProvider>
  )
}

export default App
