'use strict';

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {string} [contentType]
 */
function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {{ error: string, code?: string }} payload
 */
function sendJsonError(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * @param {import('http').ServerResponse} res
 * @param {unknown} payload
 */
function sendJson(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

module.exports = {
  sendText,
  sendJsonError,
  sendJson,
};
