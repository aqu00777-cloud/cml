const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lockAPI', {
    getUsername: () => ipcRenderer.invoke('get-username'),
    submitPassword: (pwd) => ipcRenderer.invoke('submit-fake-password', pwd)
});
