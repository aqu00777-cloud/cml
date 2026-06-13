const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    getHostname: () => ipcRenderer.invoke('get-hostname'), // Expose computer name
    getDrives: () => ipcRenderer.invoke('get-drives'),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
    remoteAction: (action) => ipcRenderer.invoke('remote-action', action)
});
