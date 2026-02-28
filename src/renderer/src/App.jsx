import { AuthProvider, useAuth } from './contexts/AuthContext'
import { LaunchProvider } from './contexts/LaunchContext'
import { ServersProvider } from './contexts/ServersContext'
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
    return (
      <>
        <LoginSection />
        <StatusMessage />
      </>
    )
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
        <AppContent />
      </LaunchProvider>
    </AuthProvider>
  )
}

export default App
