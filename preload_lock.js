const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lockAPI', {
    getLockscreenData: () => ipcRenderer.invoke('get-lockscreen-data'),
    submitPassword: (pwd) => ipcRenderer.invoke('submit-fake-password', pwd)
});
