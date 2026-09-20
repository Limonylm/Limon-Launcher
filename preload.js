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
    select: inv('profiles:select')
  },
  settings: {
    get: inv('settings:get'),
    set: inv('settings:set'),
    pickFolder: inv('settings:pick-folder'),
    pickJava: inv('settings:pick-java'),
    openGameDir: inv('settings:open-game-dir')
  },
  skins: {
    list: inv('skins:list'),
    add: inv('skins:add'),
    setVariant: inv('skins:set-variant'),
    remove: inv('skins:remove'),
    apply: inv('skins:apply'),
    current: inv('skins:current')
  },
  game: {
    launch: inv('game:launch'),
    stop: inv('game:stop'),
    onLog: on('game:log'),
    onProgress: on('game:progress'),
    onState: on('game:state')
  }
});
