const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('avatarlive', {
  obs: {
    connect:        (config) => ipcRenderer.invoke('obs:connect', config),
    disconnect:     ()       => ipcRenderer.invoke('obs:disconnect'),
    onConnected:    (cb)     => ipcRenderer.on('obs:connected',    (_, d) => cb(d)),
    onDisconnected: (cb)     => ipcRenderer.on('obs:disconnected', ()     => cb()),
    onError:        (cb)     => ipcRenderer.on('obs:error',        (_, m) => cb(m)),
  },
  avatar: {
    switch:   (name) => ipcRenderer.invoke('avatar:switch', name),
    onChange: (cb)   => ipcRenderer.on('avatar:changed', (_, name) => cb(name)),
  },
  twitch: {
    connect:        (config) => ipcRenderer.invoke('twitch:connect', config),
    disconnect:     ()       => ipcRenderer.invoke('twitch:disconnect'),
    onConnected:    (cb)     => ipcRenderer.on('twitch:connected',    (_, ch) => cb(ch)),
    onDisconnected: (cb)     => ipcRenderer.on('twitch:disconnected', ()      => cb()),
    onError:        (cb)     => ipcRenderer.on('twitch:error',        (_, m)  => cb(m)),
    onMessage:      (cb)     => ipcRenderer.on('twitch:message',      (_, m)  => cb(m)),
  },
  streamdeck: {
    connect:     ()   => ipcRenderer.invoke('streamdeck:connect'),
    onConnected: (cb) => ipcRenderer.on('streamdeck:connected', ()     => cb()),
    onKeydown:   (cb) => ipcRenderer.on('streamdeck:keydown',   (_, k) => cb(k)),
  },
  getState: () => ipcRenderer.invoke('app:getState'),
});
