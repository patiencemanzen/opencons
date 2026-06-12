import { RequestHandler } from 'express';

export interface RouteGrapherOptions {
  port?: number;
  enabled?: boolean;
  enableWidget?: boolean;
  exclude?: string[];
  captureBody?: boolean;
  captureResponse?: boolean;
  maxTraces?: number;
  drivers?: {
    mongoose?: boolean;
    drizzle?: boolean;
    pg?: boolean;
    prisma?: boolean;
    mysql2?: boolean;
  };
  transform?: {
    enabled?: boolean;
    projectRoot?: string;
    exclude?: string[];
  };
}

export interface TraceGraph {
  id: string;
  method: string;
  url: string;
  status: number | null;
  duration_ms: number;
  body?: unknown;
  response?: unknown;
  nodes: object[];
  edges: object[];
}

export interface RouteGrapherMiddleware extends RequestHandler {
  getTraces: () => TraceGraph[];
  options: RouteGrapherOptions;
  __routegrapherEntry: boolean;
}

export interface RouteGrapher {
  (options?: RouteGrapherOptions): RouteGrapherMiddleware;
  applyToNest(
    nestApp: { getHttpAdapter(): { getInstance(): unknown } },
    options?: RouteGrapherOptions,
  ): RouteGrapherMiddleware;
  createNestMiddleware(options?: RouteGrapherOptions): RouteGrapherMiddleware;
  label<T extends Function>(name: string, handler: T): T;
}

declare const routegrapher: RouteGrapher;

export default routegrapher;
