import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { showStatus } from "../common/StatusMessage";
import minecraftIcon from "../../assets/imgs/minecraft_icon.png";

export default function LoginSection() {
  const { login } = useAuth();
  const [loggingIn, setLoggingIn] = useState(false);

  const handleLogin = async () => {
    try {
      setLoggingIn(true);
      showStatus("Abriendo ventana de Microsoft...", "info");
      await login();
      showStatus("Autenticacion exitosa!", "success");
    } catch (err) {
      console.error("Login error:", err);
      showStatus(err.desc || err.message || "Error al iniciar sesion", "error");
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="auth-bg w-screen h-screen flex items-center justify-center overflow-hidden font-inter relative">
      <div className="text-center relative">
        <div>
          <h1 className="font-black text-[4rem] tracking-[-3px] text-white uppercase font-inter">
            NONAME<span className="text-accent-green animate-blink">_</span>
          </h1>
          <p className="text-[0.7rem] text-white/50 tracking-[8px] indent-[8px] font-normal mb-[50px] font-inter">
            LAUNCHER
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <button
            className="bg-white/5 text-white border border-white/10 py-4 px-8 rounded inline-flex items-center justify-center gap-3 font-medium text-[0.9rem] transition-all duration-300 w-full backdrop-blur-[10px] hover:bg-white/10 hover:border-accent-green hover:shadow-[0_0_25px_rgba(74,222,128,0.2)] hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none font-inter cursor-pointer"
            onClick={handleLogin}
            disabled={loggingIn}
          >
            <img src={minecraftIcon} className="w-5 h-5 object-contain" alt="Minecraft" />
            {loggingIn ? "AUTENTICANDO..." : "INICIA SESIÓN CON MICROSOFT"}
          </button>
        </div>
      </div>

      <p className="absolute bottom-10 w-full text-center text-[0.6rem] text-white/10 uppercase tracking-[2px] font-inter">
        NoName Launcher · Build 0.2.1-IND
      </p>
    </div>
  );
}
