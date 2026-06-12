'use strict';

class OpenconsError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'OPENCONS_ERROR') {
    super(message);
    this.name = 'OpenconsError';
    this.code = code;
  }
}

class ConfigurationError extends OpenconsError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

class WidgetServerError extends OpenconsError {
  /**
   * @param {string} message
   * @param {NodeJS.ErrnoException | null} [cause]
   */
  constructor(message, cause = null) {
    super(message, 'WIDGET_SERVER_ERROR');
    this.name = 'WidgetServerError';
    if (cause) {
      this.cause = cause;
    }
  }
}

class WebSocketError extends OpenconsError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 'WEBSOCKET_ERROR');
    this.name = 'WebSocketError';
  }
}

module.exports = {
  OpenconsError,
  ConfigurationError,
  WidgetServerError,
  WebSocketError,
};
