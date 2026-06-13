const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');

function createWindow() {
    const win = new BrowserWindow({
        show: false, // Make the window completely hidden
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('index.html');
}

// Auto start the app in the background when the user logs into their laptop
app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath("exe")
});

app.whenReady().then(() => {
    // Get all screen sources
    ipcMain.handle('get-sources', async () => {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        return sources.map(source => ({
            id: source.id,
            name: source.name
        }));
    });

    // Provide the computer name so the admin knows which laptop it is
    ipcMain.handle('get-hostname', () => os.hostname());

    createWindow();
});

// Keep running in the background even if a window is closed
app.on('window-all-closed', () => {
    // Do nothing, we want it to stay alive
});