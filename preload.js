const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    getHostname: () => ipcRenderer.invoke('get-hostname'), // Expose computer name
    getDrives: () => ipcRenderer.invoke('get-drives'),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
    getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
    readFileChunk: (filePath, start, end) => ipcRenderer.invoke('read-file-chunk', filePath, start, end),
    remoteAction: (action) => ipcRenderer.invoke('remote-action', action)
});
