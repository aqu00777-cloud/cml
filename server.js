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
  socket.on('register-client', (hostname) => {
    console.log('Target Laptop Connected:', hostname, socket.id);
    clients[socket.id] = { id: socket.id, name: hostname };
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

  // Admin clicks to watch a specific laptop
  socket.on('request-offer', (targetClientId) => {
    io.to(targetClientId).emit('request-offer', socket.id);
  });

  // WebRTC Signaling relays
  socket.on('offer', (data) => {
    io.to(data.targetId).emit('offer', { offer: data.offer, from: socket.id });
  });

  socket.on('answer', (data) => {
    io.to(data.targetId).emit('answer', { answer: data.answer, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.targetId).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    if (clients[socket.id]) {
      console.log('Target Laptop Disconnected:', clients[socket.id].name);
      delete clients[socket.id];
      io.emit('client-list', clients);
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
