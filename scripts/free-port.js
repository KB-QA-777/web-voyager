'use strict';
// Prints a free TCP port. Used by playwright.config.js so that several runs can start
// their own app instance side by side without colliding.
const net = require('net');
const srv = net.createServer();
srv.listen(0, '127.0.0.1', () => {
  const { port } = srv.address();
  srv.close(() => process.stdout.write(String(port)));
});
