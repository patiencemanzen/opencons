'use strict';

const { WebSocketServer } = require('ws');
const { getServer, getListeningPort } = require('./static');
const { logger } = require('../lib/logger');
const { WebSocketError } = require('../lib/errors');

/** @type {import('ws').WebSocketServer | null} */
let wss = null;

/**
 * @param {ReturnType<import('../store/trace-store').createTraceStore>} traceStore
 */
function createWebSocketServer(traceStore) {
  if (wss) return wss;

  const httpServer = getServer();
  const port = getListeningPort();

  if (!httpServer || !port) {
    throw new WebSocketError('HTTP server must be listening before WebSocket server');
  }

  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket) => {
    traceStore.subscribe(socket);

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        if (message.type === 'get_history') {
          const limit = Math.min(100, Math.max(1, Number(message.limit) || 50));
          const history = traceStore.getAll(limit);
          socket.send(JSON.stringify({ type: 'history', payload: history }));
          return;
        }

        logger.debug(`Ignoring unknown WebSocket message type: ${message.type}`);
      } catch (err) {
        logger.debug('Ignoring malformed WebSocket message', err);
      }
    });

    socket.on('close', () => {
      traceStore.unsubscribe(socket);
    });

    socket.on('error', (err) => {
      logger.debug('WebSocket client error', err);
      traceStore.unsubscribe(socket);
    });
  });

  logger.info(`WebSocket → ws://localhost:${port}`);

  return wss;
}

/**
 * Close all WebSocket connections and the server.
 * @returns {Promise<void>}
 */
function closeWebSocketServer() {
  if (!wss) return Promise.resolve();

  return new Promise((resolve) => {
    wss.clients.forEach((client) => {
      try {
        client.terminate();
      } catch {
        // ignore errors during forced close
      }
    });

    wss.close(() => {
      wss = null;
      resolve();
    });
  });
}

module.exports = {
  createWebSocketServer,
  closeWebSocketServer,
};
