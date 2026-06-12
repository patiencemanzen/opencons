'use strict';

class RouteGrapherError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'ROUTEGRAPHER_ERROR') {
    super(message);
    this.name = 'RouteGrapherError';
    this.code = code;
  }
}

class ConfigurationError extends RouteGrapherError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

class WidgetServerError extends RouteGrapherError {
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

class WebSocketError extends RouteGrapherError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message, 'WEBSOCKET_ERROR');
    this.name = 'WebSocketError';
  }
}

module.exports = {
  RouteGrapherError,
  ConfigurationError,
  WidgetServerError,
  WebSocketError,
};
