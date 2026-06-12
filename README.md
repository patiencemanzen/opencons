# Opencons

**Live runtime execution tracing for Node.js / Express**

Opencons automatically captures and visualises the complete execution path of every HTTP request passing through your Express application — in real time, with zero instrumentation code in your handlers.

> **Development only.** Opencons is disabled when `NODE_ENV=production` unless you explicitly pass `enabled: true`.

---

## Table of contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Environment variables](#environment-variables)
- [NestJS integration](#nestjs-integration)
- [Branch tracing (AST)](#branch-tracing-ast)
- [Database capture](#database-capture)
- [Widget API](#widget-api)
- [Trace data model](#trace-data-model)
- [Project structure](#project-structure)
- [Run the example](#run-the-example)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Features

| Capability | Description |
|------------|-------------|
| Request tracing | Method, URL, status, duration per request |
| Middleware chain | `next()` detection, early-exit reasons, async errors |
| Branch probing | `if` / `switch` / loops / `try` as diamond nodes (CommonJS `.js`) |
| DB capture | Drizzle, `pg`, `mysql2`, `mongoose`, Prisma |
| Live widget | Request list, D3 execution graph, waterfall timeline |
| NestJS | Guards, interceptors, pipes, controllers |


---

## Prerequisites

- Node.js **18.0.0** or newer
- An Express 4.x application (or NestJS with the Express adapter)
- For Nest interceptor tracing: `rxjs` ^7

---

## Installation

```bash
npm install --save-dev opencons
```

---

## Quick start

Require Opencons **before** creating your Express app, and register it as the **first** middleware:

```javascript
const opencons = require('opencons'); // before express()
const express = require('express');

const app = express();

app.use(opencons()); // must be first

app.use(express.json());
app.use('/api', require('./routes'));

app.listen(3000);
```

Open the widget while your app runs:

```
http://localhost:7331
```

If port 7331 is busy, Opencons tries the next port and logs the actual URL.

---

## Configuration

```javascript
app.use(opencons({
  port: 7331,              // widget + WebSocket port
  enabled: undefined,      // set true to force enable in production (not recommended)
  enableWidget: true,      // set false in automated tests
  exclude: ['/health'],    // routes to ignore
  captureBody: false,      // snapshot request bodies on the trace
  captureResponse: false,  // snapshot response bodies (res.json / res.send)
  maxTraces: 100,          // in-memory ring buffer size
  drivers: {
    mongoose: true,
    drizzle: true,
    pg: true,
    prisma: true,
    mysql2: true,
  },
  transform: {
    enabled: false,        // AST branch probing (Phase 2)
    projectRoot: process.cwd(),
    exclude: ['vendor/**'],
  },
}));
```

Invalid options throw a `ConfigurationError` at startup with a descriptive message.

### Programmatic access

```javascript
const middleware = opencons({ enableWidget: false });
const traces = middleware.getTraces();
```

---

## Environment variables

Copy [.env.example](.env.example) into your host application. Load env **before** importing Opencons when using transform variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | — | `production` disables tracing unless `enabled: true` |
| `OPENCONS_TRANSFORM` | — | `1` or `true` installs AST hook on import |
| `OPENCONS_ROOT` | `process.cwd()` | Project root for source transforms |
| `OPENCONS_TRANSFORM_EXCLUDE` | — | Comma-separated globs to skip |
| `OPENCONS_LOG_LEVEL` | `info` | Set to `debug` for verbose library logs |

---

## NestJS integration

```typescript
// main.ts — import Opencons before NestFactory.create()
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import opencons from 'opencons';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  opencons.applyToNest(app, {
    port: 7331,
    exclude: ['/health'],
  });

  await app.listen(3000);
}

bootstrap();
```

**What gets traced**

| Layer | Traced? |
|-------|---------|
| HTTP request / response | Yes |
| Express middleware | Yes |
| Nest controllers | Yes |
| Nest guards / interceptors / pipes | Yes |

### Alternative: `MiddlewareConsumer`

```typescript
consumer
  .apply(opencons.createNestMiddleware({ port: 7331 }))
  .forRoutes('*');
```

Prefer `applyToNest()` in `main.ts` immediately after `NestFactory.create()`.

### Naming middleware

```javascript
app.use(opencons.label('bullAuth', bullAuth));
```

---

## Branch tracing (AST)

Every `if` / `switch` / `while` / `for` / `try` in **CommonJS `.js` files** under your project root can be probed at load time. Branch decisions appear as diamond nodes in the graph.

```javascript
app.use(opencons({
  transform: {
    enabled: true,
    projectRoot: process.cwd(),
    exclude: ['dist/vendor/**'],
  },
}));
```

For **NestJS** (TypeScript compiled to `dist/`), enable via `.env` so the hook runs when `Opencons` is imported:

```env
OPENCONS_TRANSFORM=1
OPENCONS_ROOT=dist/apps/api
```

```typescript
import './load-env';      // loads .env first
import opencons from 'opencons';
import { AppModule } from './app.module';
```

Or use `node -r opencons/register-transform` or `require('opencons/register-transform')()` before other imports.

Skip a file with `// opencons-skip` at the top.

---

## Database capture

Database queries appear as **blue fork nodes** off the handler that triggered them.

| Driver | Package |
|--------|---------|
| Drizzle ORM | `drizzle-orm` |
| PostgreSQL | `pg` |
| MySQL | `mysql2` |
| MongoDB | `mongoose` |
| Prisma | `@prisma/client` |

Load `Opencons` before creating database clients. When `drizzle-orm` is installed, Opencons captures at the ORM layer and skips raw `pg`/`mysql2` to avoid duplicates.

```javascript
opencons.applyToNest(app, {
  drivers: { drizzle: true, mongoose: false },
});
```

---

## Widget API

The dev widget server exposes a minimal HTTP API (no authentication — local dev only).

### `GET /api/source`

Returns a source snippet for branch peek in the graph.

| Query param | Required | Description |
|-------------|----------|-------------|
| `file` | Yes | Project-relative path or basename |
| `line` | No | 1-based line number (default: 1) |

**Responses**

| Status | Body |
|--------|------|
| 200 | `{ file, line, startLine, lines: [{ number, text, highlight }] }` |
| 400 | `{ error, code: "MISSING_FILE_PARAM" }` |
| 404 | `{ error, code: "SOURCE_NOT_FOUND" }` |

### WebSocket protocol

Connect to `ws://localhost:<port>` (same port as the widget).

**Client → server**

```json
{ "type": "get_history", "limit": 50 }
```

**Server → client**

| Type | When |
|------|------|
| `trace_start` | Request begins |
| `trace_update` | Live progress |
| `trace` | Request completed |
| `history` | Response to `get_history` |

---

## Trace data model

Each request produces a directed acyclic graph (DAG):

```json
{
  "id": "req_a1b2c3",
  "method": "GET",
  "url": "/api/users/1",
  "status": 200,
  "duration_ms": 12.4,
  "body": null,
  "response": { "id": 1, "name": "Ada" },
  "nodes": [
    { "id": "n1", "type": "request", "label": "GET /api/users/1" },
    { "id": "n2", "type": "middleware", "label": "authMiddleware", "duration_ms": 0.5, "called_next": true },
    { "id": "n3", "type": "response", "label": "200" }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" }
  ]
}
```

---

## Project structure

```
open-route/
├── src/
│   ├── index.js                 # Package entry — Express patch on import
│   ├── core/                    # Middleware, tracer, AsyncLocalStorage
│   ├── lib/                     # Config, logger, errors, HTTP helpers
│   ├── interceptors/            # Express + require-hook patches
│   ├── transform/               # Babel branch probe injection
│   ├── store/                   # Trace ring buffer + source cache
│   ├── server/                  # Widget HTTP + WebSocket
│   ├── drivers/                 # DB driver patches
│   ├── integrations/            # NestJS helpers
│   └── utils/                   # label(), observable()
├── widget/                      # Browser dev UI
├── examples/sample-app/         # Runnable Express demo
├── test/                        # Node.js test runner
├── scripts/                     # Maintenance scripts
├── CONTRIBUTING.md
├── .env.example
└── opencons.d.ts
```

---

## Run the example

```bash
npm install
npm run start:example
```

1. Open http://localhost:7331 for the widget
2. Fire requests against http://localhost:3000:

```bash
curl http://localhost:3000/api/public
curl http://localhost:3000/api/users/42
curl -H "Authorization: Bearer dev" http://localhost:3000/api/users/42
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev" \
  -d "{\"items\":[1]}"
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, coding conventions, and test instructions.

---

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Request boundary, middleware chain, widget | Done |
| 2 | AST branch probing, source peek | Done |
| 3 | Database driver capture | Done |
| 4 | TypeScript / ESM transforms, replay mode | Planned |

---

## License

MIT — see [LICENSE](LICENSE).
