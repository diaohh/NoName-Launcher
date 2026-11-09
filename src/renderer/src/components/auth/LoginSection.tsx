import { useState } from "react"
import { useAuth } from "../../contexts/AuthContext"
import { useStatus } from "../../contexts/StatusContext"
import { errorMessage } from "../../services/errors"
import AppLogo from "../common/AppLogo"
import LoginIcon from "./LoginIcon"

export default function LoginSection() {
  const { login } = useAuth()
  const { showStatus } = useStatus()
  const [loggingIn, setLoggingIn] = useState(false)

  const handleLogin = async () => {
    try {
      setLoggingIn(true)
      await login()
    } catch (err) {
      console.error("Login error:", err)
      showStatus(errorMessage(err, "Error al iniciar sesion"), "error")
    } finally {
      setLoggingIn(false)
    }
  }

  return (
    <div className="auth-bg w-full h-full flex items-center justify-center overflow-hidden font-inter relative">
      <div className="text-center relative">
        <h1 className="mb-[50px]">
          <AppLogo className="w-[420px] max-w-[80vw] mx-auto" />
        </h1>

        <div className="flex flex-col gap-5">
          <button
            className="bg-white/5 text-white border border-white/10 py-4 px-8 rounded-full inline-flex items-center justify-center gap-3 font-medium text-[0.9rem] transition-all duration-300 w-full backdrop-blur-[10px] hover:bg-white/10 hover:border-accent-orange hover:shadow-[0_0_25px_rgba(216,121,67,0.35)] hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none font-inter cursor-pointer"
            onClick={handleLogin}
            disabled={loggingIn}
          >
            <LoginIcon />
            {loggingIn ? "AUTENTICANDO..." : "INICIA SESIÓN CON MICROSOFT"}
          </button>
        </div>
      </div>

      <p className="absolute bottom-10 w-full text-center text-[0.6rem] text-white/10 uppercase tracking-[2px] font-inter">
        NoName Launcher · Build {__APP_VERSION__}
      </p>
    </div>
  )
}
