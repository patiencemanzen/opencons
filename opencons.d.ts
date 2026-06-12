import { RequestHandler } from 'express';

export interface OpenconsOptions {
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

export interface OpenconsMiddleware extends RequestHandler {
  getTraces: () => TraceGraph[];
  options: OpenconsOptions;
  __openconsEntry: boolean;
}

export interface Opencons {
  (options?: OpenconsOptions): OpenconsMiddleware;
  applyToNest(
    nestApp: { getHttpAdapter(): { getInstance(): unknown } },
    options?: OpenconsOptions,
  ): OpenconsMiddleware;
  createNestMiddleware(options?: OpenconsOptions): OpenconsMiddleware;
  label<T extends Function>(name: string, handler: T): T;
}

declare const opencons: Opencons;

export default opencons;
