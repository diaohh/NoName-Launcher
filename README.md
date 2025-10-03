# NoNameLauncher

Un launcher simple de Minecraft construido con Electron

## 🎯 Características Implementadas

✅ **Autenticación con Microsoft**
- Flujo OAuth completo
- Refresh automático de tokens
- Almacenamiento seguro de credenciales

✅ **Gestión de Java**
- Descarga automática de Java 17
- Validación de versión
- Configuración de RAM

✅ **Arquitectura Profesional**
- Patrón MVC (Model-View-Controller)
- Arquitectura en Capas (Layered Architecture)
- Separación de responsabilidades
- Logging estructurado

## 📁 Estructura del Proyecto

```
NoNameLauncher/
├── src/
│   ├── main/                      # Proceso principal de Electron
│   │   ├── index.js               # Punto de entrada
│   │   ├── ipc/                   # IPC communication
│   │   │   └── constants.js
│   │   └── windows/               # Gestión de ventanas
│   │
│   ├── renderer/                  # Proceso renderer
│   │   ├── views/                 # Vistas HTML
│   │   │   └── main.html
│   │   ├── js/
│   │   │   ├── managers/          # Lógica de negocio
│   │   │   │   ├── AuthManager.js
│   │   │   │   ├── ConfigManager.js
│   │   │   │   └── LaunchManager.js
│   │   │   └── utils/
│   │   │       └── Logger.js
│   │   └── css/
│   │
│   └── preload.js                 # Preload script
│
├── .env.example                   # Ejemplo de variables de entorno
└── package.json
```

## 🚀 Instalación y Uso

### 1. Configurar Variables de Entorno

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

Edita `.env` y configura:

```env
# Microsoft Azure App Configuration
MICROSOFT_CLIENT_ID=tu-client-id-aqui

# Launcher Configuration
LAUNCHER_NAME=NoNameLauncher
LAUNCHER_VERSION=1.0.0
```

#### ⚠️ Obtener Microsoft Client ID

**Para Testing (temporal):**
- El launcher incluye un Client ID por defecto que funciona para pruebas

**Para Producción (REQUERIDO):**
1. Ve a [Azure Portal](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click en "New registration"
3. Nombre: NoNameLauncher
4. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
5. Redirect URI: `https://login.microsoftonline.com/common/oauth2/nativeclient`
6. Registra y copia el "Application (client) ID"

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Ejecutar el Launcher

```bash
npm start
```

## 🎮 Cómo Usar

### Primera Vez

1. **Iniciar Sesión**
   - Click en "Iniciar sesión con Microsoft"
   - Se abrirá una ventana del navegador
   - Inicia sesión con tu cuenta Microsoft
   - El launcher guardará automáticamente tus credenciales

2. **Lanzar Minecraft**
   - Click en "▶ JUGAR"
   - El launcher automáticamente:
     - Validará tu cuenta
     - Descargará Java 17 si es necesario
     - Iniciará Minecraft

### Siguientes Veces

- El launcher recordará tu cuenta
- Los tokens se refrescarán automáticamente
- Java ya estará instalado

## 🏗️ Arquitectura

### Patrones de Diseño Utilizados

#### 1. **Layered Architecture (Arquitectura en Capas)**
```
┌─────────────────────────────────────┐
│   Presentation (Views HTML)         │
├─────────────────────────────────────┤
│   Controller (Event Handlers)       │
├─────────────────────────────────────┤
│   Business Logic (Managers)         │
├─────────────────────────────────────┤
│   Core (helios-core)                │
├─────────────────────────────────────┤
│   Infrastructure (Electron/Node)    │
└─────────────────────────────────────┘
```

#### 2. **MVC Pattern**
- **Model:** Managers (AuthManager, ConfigManager, LaunchManager)
- **View:** HTML files (main.html)
- **Controller:** Event handlers en las vistas

#### 3. **Singleton Pattern**
- ConfigManager: instancia única global
- Logger: gestión centralizada de logs

### Managers Principales

#### ConfigManager
**Responsabilidades:**
- Gestión de configuración persistente
- Almacenamiento de cuentas
- Configuración de Java y juego
- Validación de estructura

**Ubicación:** `src/renderer/js/managers/ConfigManager.js`

**Métodos clave:**
```javascript
ConfigManager.load()                    // Cargar configuración
ConfigManager.save()                    // Guardar configuración
ConfigManager.getSelectedAccount()      // Obtener cuenta activa
ConfigManager.addMicrosoftAccount()     // Añadir cuenta MS
```

#### AuthManager
**Responsabilidades:**
- Autenticación OAuth de Microsoft
- Refresh de tokens
- Validación de cuentas
- Manejo de errores de auth

**Ubicación:** `src/renderer/js/managers/AuthManager.js`

**Flujo de autenticación:**
1. Obtener código de autorización (OAuth)
2. Obtener Access Token de Microsoft
3. Obtener XBL Token
4. Obtener XSTS Token
5. Obtener Minecraft Access Token
6. Obtener perfil de Minecraft

**Métodos clave:**
```javascript
AuthManager.fullMicrosoftAuthFlow()         // Flujo completo
AuthManager.addMicrosoftAccount(code)       // Añadir cuenta
AuthManager.validateSelectedMicrosoftAccount() // Validar/refresh
```

#### LaunchManager
**Responsabilidades:**
- Validación de Java
- Descarga automática de Java 17
- Construcción del comando de lanzamiento
- Inicio del proceso de Minecraft

**Ubicación:** `src/renderer/js/managers/LaunchManager.js`

**Métodos clave:**
```javascript
LaunchManager.ensureJava()              // Verificar/descargar Java
LaunchManager.launchMinecraft()         // Lanzar Minecraft
```

## 🔐 Seguridad

### Almacenamiento de Tokens
- **Ubicación:** `%APPDATA%/.nonamelauncher/config.json`
- **Formato:** JSON
- **Contenido:**
  - Access tokens de Minecraft
  - Refresh tokens de Microsoft
  - Timestamps de expiración
  - Información de perfil

### Refresh Automático
- **MC Token expirado + MS Token válido:** Solo refresca MC token
- **Ambos expirados:** Refresca ambos usando refresh_token
- **Buffer de seguridad:** 10 segundos antes de expiración

### Logs Seguros
- Access tokens ocultos en logs (`**********`)
- Solo información necesaria registrada

## 📝 Configuración Avanzada

### Archivo de Configuración (config.json)

Ubicación: `%APPDATA%/.nonamelauncher/config.json`

```json
{
    "settings": {
        "game": {
            "resWidth": 1280,
            "resHeight": 720,
            "fullscreen": false
        },
        "java": {
            "minRAM": "2G",
            "maxRAM": "4G",
            "executable": null,
            "autoDownload": true
        },
        "launcher": {
            "dataDirectory": "..."
        }
    },
    "selectedAccount": "uuid-de-la-cuenta",
    "authenticationDatabase": {
        "uuid-de-la-cuenta": {
            "type": "microsoft",
            "accessToken": "...",
            "username": "PlayerName",
            "uuid": "...",
            "displayName": "PlayerName",
            "expiresAt": 1234567890,
            "microsoft": {
                "access_token": "...",
                "refresh_token": "...",
                "expires_at": 1234567890
            }
        }
    }
}
```

### Opciones de Java

**RAM Mínima/Máxima:**
```javascript
ConfigManager.setMinRAM('2G')
ConfigManager.setMaxRAM('4G')
```

**Ejecutable Java personalizado:**
```javascript
ConfigManager.setJavaExecutable('C:/path/to/java.exe')
```

**Auto-descarga:**
```javascript
ConfigManager.setJavaAutoDownload(true) // Descarga automática
ConfigManager.setJavaAutoDownload(false) // Manual
```

## 🐛 Troubleshooting

### Error: "No valid Java installation found"
**Solución:**
1. Activar auto-descarga:
   ```javascript
   ConfigManager.setJavaAutoDownload(true)
   ConfigManager.save()
   ```
2. O configurar manualmente:
   ```javascript
   ConfigManager.setJavaExecutable('C:/path/to/javaw.exe')
   ConfigManager.save()
   ```

### Error: "Account validation failed"
**Solución:**
1. Cerrar sesión
2. Volver a iniciar sesión con Microsoft

### Launcher no inicia
**Solución:**
1. Verificar que `.env` existe y tiene el Client ID
2. Verificar logs en consola (DevTools)
3. Borrar `config.json` y reintentar

## 📚 Próximos Pasos (Roadmap)

### Funcionalidades Pendientes

- [ ] **Vista de Settings completa**
  - Configuración de RAM con sliders
  - Selector de ejecutable Java
  - Selector de directorio de datos
  - Información detallada del jugador

- [ ] **Sistema de distribución**
  - Soporte para distribution.json
  - Descarga de assets y librerías
  - Validación de checksums

- [ ] **Preview de Skin**
  - Renderizado 3D de la skin
  - Vista rotativa del personaje

- [ ] **ProcessBuilder completo**
  - Soporte para Forge/Fabric
  - Gestión de mods
  - Argumentos JVM optimizados por versión

- [ ] **UI/UX mejorado**
  - Animaciones
  - Tema oscuro/claro
  - Multi-idioma

## 📖 Recursos y Referencias

- **HeliosLauncher:** [GitHub](https://github.com/dscalzi/HeliosLauncher)
- **helios-core:** [NPM](https://www.npmjs.com/package/helios-core)
- **Microsoft Auth:** [Docs](https://learn.microsoft.com/en-us/azure/active-directory/develop/)
- **Electron:** [Docs](https://www.electronjs.org/docs)

## 🤝 Contribuir

Este proyecto está en desarrollo activo. Sugerencias y mejoras son bienvenidas.

## 📄 Licencia

MIT License - ve el archivo LICENSE para más detalles.

---
