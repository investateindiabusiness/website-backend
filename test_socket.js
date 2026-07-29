const { io } = require('socket.io-client');

console.log('Connecting to socket server at http://localhost:5001 ...');
const socket = io('http://localhost:5001', {
  transports: ['websocket']
});

socket.on('connect', () => {
  console.log('Connected! Socket ID:', socket.id);
  
  console.log('Sending join_user event for test_user_id...');
  socket.emit('join_user', 'test_user_id');
  
  console.log('Sending join_zone event for zone1...');
  socket.emit('join_zone', 'zone1');
});

socket.on('new_coupon', (data) => {
  console.log('Received new_coupon event:', data);
  socket.disconnect();
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err);
  process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log('Timeout. Disconnecting...');
  socket.disconnect();
  process.exit(0);
}, 10000);
