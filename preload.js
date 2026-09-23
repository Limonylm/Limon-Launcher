const { contextBridge, ipcRenderer } = require('electron');

const inv = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('limon', {
  win: {
    min: () => ipcRenderer.send('win:min'),
    max: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close')
  },
  versions: inv('versions:list'),
  openExternal: inv('shell:open-external'),
  installedVersions: inv('versions:installed'),
  system: inv('system:info'),
  accounts: {
    list: inv('accounts:list'),
    addOffline: inv('accounts:add-offline'),
    loginMs: inv('accounts:login-ms'),
    select: inv('accounts:select'),
    remove: inv('accounts:remove')
  },
  profiles: {
    list: inv('profiles:list'),
    save: inv('profiles:save'),
    remove: inv('profiles:remove'),
    select: inv('profiles:select'),
    openDir: inv('profiles:open-dir'),
    cleanInstall: inv('profiles:clean-install')
  },
  settings: {
    get: inv('settings:get'),
    set: inv('settings:set'),
    pickFolder: inv('settings:pick-folder'),
    pickJava: inv('settings:pick-java'),
    openGameDir: inv('settings:open-game-dir'),
    openDataDir: inv('settings:open-data-dir'),
    reset: inv('settings:reset'),
    testDiscord: inv('discord:test')
  },
  skins: {
    list: inv('skins:list'),
    add: inv('skins:add'),
    setVariant: inv('skins:set-variant'),
    remove: inv('skins:remove'),
    apply: inv('skins:apply'),
    current: inv('skins:current')
  },
  modrinth: {
    search: inv('modrinth:search'),
    install: inv('modrinth:install'),
    installModpack: inv('modrinth:install-modpack')
  },
  content: {
    list: inv('content:list'),
    remove: inv('content:remove'),
    toggle: inv('content:toggle'),
    onProgress: on('content:progress')
  },
  update: {
    check: inv('update:check'),
    install: inv('update:install'),
    onAvailable: on('update:available'),
    onProgress: on('update:progress'),
    onError: on('update:error')
  },
  discordLog: {
    get: inv('discord:log'),
    onLine: on('discord:log')
  },
  capes: {
    set: inv('capes:set')
  },
  game: {
    launch: inv('game:launch'),
    stop: inv('game:stop'),
    onLog: on('game:log'),
    onProgress: on('game:progress'),
    onState: on('game:state')
  }
});
