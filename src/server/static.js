'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const sourceCache = require('../store/source-cache');
const { logger } = require('../lib/logger');
const { WidgetServerError } = require('../lib/errors');
const { sendText, sendJsonError, sendJson } = require('../lib/http-response');

/** @type {http.Server | null} */
let server = null;

/** @type {number | null} */
let listeningPort = null;

const WIDGET_ROOT = path.join(__dirname, '..', '..', 'widget');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function handleWidgetRequest(req, res) {
  try {
    if (req.url && req.url.startsWith('/api/source')) {
      return handleSourceApi(req, res);
    }

    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = path.normalize(path.join(WIDGET_ROOT, urlPath));

    if (!filePath.startsWith(WIDGET_ROOT)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        sendText(res, 404, 'Not found');
        return;
      }

      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    logger.error('Widget request handler failed', err);
    sendJsonError(res, 500, { error: 'Internal server error', code: 'WIDGET_REQUEST_ERROR' });
  }
}

/**
 * @param {number} port
 * @param {number} [maxAttempts]
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
function createStaticServer(port, maxAttempts = 10) {
  if (server && listeningPort) {
    return Promise.resolve({ server, port: listeningPort });
  }

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryListen = (candidatePort) => {
      const httpServer = http.createServer(handleWidgetRequest);

      const onError = (err) => {
        httpServer.removeListener('error', onError);
        httpServer.close(() => {});

        if (err.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
          attempt += 1;
          const nextPort = port + attempt;

          if (attempt === 1) {
            logger.warn(
              `Port ${candidatePort} is in use — trying ${nextPort}. ` +
                'Kill the old process or set opencons({ port: N }).'
            );
          }

          tryListen(nextPort);
          return;
        }

        reject(new WidgetServerError(`Failed to bind widget server on port ${candidatePort}`, err));
      };

      httpServer.once('error', onError);
      httpServer.listen(candidatePort, () => {
        httpServer.removeListener('error', onError);
        server = httpServer;
        listeningPort = candidatePort;

        logger.info(`Widget → http://localhost:${candidatePort}`);

        if (candidatePort !== port) {
          logger.warn(
            `Port ${port} was busy. Open http://localhost:${candidatePort} (not ${port}).`
          );
        }

        resolve({ server: httpServer, port: candidatePort });
      });
    };

    tryListen(port);
  });
}

/**
 * @returns {http.Server | null}
 */
function getServer() {
  return server;
}

/**
 * @returns {number | null}
 */
function getListeningPort() {
  return listeningPort;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function handleSourceApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const file = url.searchParams.get('file');
  const line = Number(url.searchParams.get('line')) || 1;

  if (!file) {
    sendJsonError(res, 400, { error: 'file query param required', code: 'MISSING_FILE_PARAM' });
    return;
  }

  const snippet = sourceCache.getSnippet(file, line);

  if (!snippet) {
    sendJsonError(res, 404, { error: 'source not found', code: 'SOURCE_NOT_FOUND' });
    return;
  }

  sendJson(res, snippet);
}

module.exports = {
  createStaticServer,
  getServer,
  getListeningPort,
};
