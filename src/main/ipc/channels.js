export const Channels = {
  // Auth
  AUTH_MSFT_LOGIN: 'auth:msftLogin',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_VALIDATE: 'auth:validate',
  AUTH_GET_ACCOUNT: 'auth:getAccount',
  AUTH_TOKEN_EXPIRED: 'auth:tokenExpired',

  // Config
  CONFIG_LOAD: 'config:load',
  CONFIG_SAVE: 'config:save',
  CONFIG_GET_SETTINGS: 'config:getSettings',
  CONFIG_SET_JAVA_EXECUTABLE: 'config:setJavaExecutable',
  CONFIG_SET_JAVA_AUTO_DOWNLOAD: 'config:setJavaAutoDownload',
  CONFIG_SET_GAME_WIDTH: 'config:setGameWidth',
  CONFIG_SET_GAME_HEIGHT: 'config:setGameHeight',
  CONFIG_SET_FULLSCREEN: 'config:setFullscreen',
  CONFIG_SET_DATA_DIRECTORY: 'config:setDataDirectory',

  // Dialogs
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
  SHELL_OPEN_PATH: 'shell:openPath',

  // Distribution
  DISTRO_LOAD: 'distro:load',
  DISTRO_GET_SERVERS: 'distro:getServers',
  DISTRO_SELECT_SERVER: 'distro:selectServer',
  DISTRO_GET_SELECTED: 'distro:getSelected',
  DISTRO_SET_SERVER_DATA: 'distro:setServerData',

  // Launch
  LAUNCH_GAME: 'launch:game',
  LAUNCH_PROGRESS: 'launch:progress',
  LAUNCH_KILL: 'launch:kill',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close'
}
