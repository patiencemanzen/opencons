**Live execution tracing for Node.js / Express — see exactly what your requests are doing, as they happen.**

Opencons plugs into your Express app and gives you a real-time visual of every HTTP request's journey: which middleware ran, what branches were taken, what queries fired, and how long each step took. No manual instrumentation. No modifying your handlers. Just plug it in and watch.

> ⚠️ **Built for development.** Opencons stays off when `NODE_ENV=production` unless you deliberately override it. Keep it that way.

---

## Table of contents

- [Why Opencons?](#why-opencons)
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
- [Running the example app](#running-the-example-app)
- [Contributing](#contributing)
- [License](#license)

---

## Why Opencons?

When a request fails or slows down, the usual approach is sprinkling `console.log` statements everywhere and guessing. Opencons gives you a better alternative: a full picture of what actually happened, structured as a visual graph.

Here's what you get out of the box:

| Capability | What it tells you |
|---|---|
| **Request tracing** | Method, URL, status code, and total duration for every request |
| **Middleware chain** | Which middleware ran, whether it called `next()`, and where it bailed out |
| **Branch probing** | Which `if` / `switch` / `try` paths were actually taken |
| **Database capture** | Every query that fired, linked to the handler that triggered it |
| **Live widget** | A browser-based UI with a request list, execution graph, and waterfall timeline |
| **NestJS support** | Guards, interceptors, pipes, and controllers — all traced |

---

## Prerequisites

Before you install, make sure you have:

- **Node.js 18.0.0 or newer**
- An **Express 4.x** application — or NestJS using the Express adapter
- If you're tracing NestJS interceptors: **`rxjs` ^7**

---

## Installation

```bash
npm install --save-dev opencons
```

Since this is a dev tool, installing it as a dev dependency keeps it out of your production bundle.

---

## Quick start

There are two rules to follow when setting up Opencons:

1. **Require it before you create your Express app.**
2. **Register it as your first middleware.**

Both matter. If Express is created first, Opencons can't attach to the request lifecycle correctly.

```javascript
const opencons = require('opencons'); // must come before express()
const express = require('express');

const app = express();

app.use(opencons()); // must be the first middleware

app.use(express.json());
app.use('/api', require('./routes'));

app.listen(3000);
```

Once your app is running, open the widget in your browser:

```
http://localhost:7331
```

If port `7331` is already in use, Opencons will automatically try the next available port and log the actual URL to your console.

---

## Configuration

Opencons works with zero configuration, but here's everything you can tune:

```javascript
app.use(opencons({
  port: 7331,              // Port for the widget UI and WebSocket connection
  enabled: undefined,      // Override to `true` if you need it on in production (not recommended)
  enableWidget: true,      // Set to `false` when running automated tests
  exclude: ['/health'],    // Routes to ignore entirely — useful for health checks
  captureBody: false,      // Whether to snapshot request bodies in the trace
  captureResponse: false,  // Whether to snapshot response bodies (res.json / res.send)
  maxTraces: 100,          // How many traces to keep in the in-memory ring buffer
  drivers: {
    mongoose: true,
    drizzle: true,
    pg: true,
    prisma: true,
    mysql2: true,
  },
  transform: {
    enabled: false,        // Enable AST branch probing (see Branch tracing section)
    projectRoot: process.cwd(),
    exclude: ['vendor/**'],
  },
}));
```

If you pass an invalid option, Opencons throws a `ConfigurationError` at startup with a clear message telling you what's wrong — it won't silently misbehave.

### Accessing traces programmatically

If you want to read trace data in tests or scripts without the widget running:

```javascript
const middleware = opencons({ enableWidget: false });
const traces = middleware.getTraces();
```

---

## Environment variables

Copy `.env.example` into your project. If you're using the `transform` variables, make sure your `.env` is loaded **before** Opencons is imported.

| Variable | Default | What it does |
|---|---|---|
| `NODE_ENV` | — | Setting this to `production` disables Opencons unless `enabled: true` is passed |
| `OPENCONS_TRANSFORM` | — | Set to `1` or `true` to install the AST hook at import time |
| `OPENCONS_ROOT` | `process.cwd()` | The project root Opencons uses when resolving files for source transforms |
| `OPENCONS_TRANSFORM_EXCLUDE` | — | Comma-separated glob patterns for files to skip during transformation |
| `OPENCONS_LOG_LEVEL` | `info` | Set to `debug` to get verbose internal logs from Opencons |

---

## NestJS integration

NestJS needs a slightly different setup. Import Opencons before calling `NestFactory.create()` — the same "before everything else" rule applies.

```typescript
// main.ts
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

**What gets traced in NestJS:**

| Layer | Traced? |
|---|---|
| HTTP request / response | ✅ Yes |
| Express middleware | ✅ Yes |
| Nest controllers | ✅ Yes |
| Guards, interceptors, and pipes | ✅ Yes |

### Alternative: `MiddlewareConsumer`

If you prefer wiring Opencons through the module system:

```typescript
consumer
  .apply(opencons.createNestMiddleware({ port: 7331 }))
  .forRoutes('*');
```

That said, the `applyToNest()` approach in `main.ts` is preferred — it ensures Opencons is in place before any requests can arrive.

### Giving your middleware a name

When you're wrapping anonymous middleware functions, you can give them a label so they show up clearly in the trace graph:

```javascript
app.use(opencons.label('bullAuth', bullAuth));
```

---

## Branch tracing (AST)

By default, Opencons traces which middleware and handlers ran. With branch tracing enabled, it goes deeper — it instruments every `if`, `switch`, `while`, `for`, and `try` block in your code at load time, so you can see exactly which code paths executed for any given request.

Branch decisions appear as **diamond nodes** in the execution graph.

> **Heads up:** This currently works on **CommonJS `.js` files** only. TypeScript files compiled to `dist/` are supported in NestJS via the environment variable approach below.

### Enable in Express

```javascript
app.use(opencons({
  transform: {
    enabled: true,
    projectRoot: process.cwd(),
    exclude: ['dist/vendor/**'], // skip files you don't need traced
  },
}));
```

### Enable in NestJS (TypeScript)

For NestJS, the hook needs to run when Opencons is first imported — before any of your compiled code loads. Use environment variables to set this up:

```env
OPENCONS_TRANSFORM=1
OPENCONS_ROOT=dist/apps/api
```

Then, in `main.ts`, make sure your `.env` is loaded first:

```typescript
import './load-env';      // loads .env before anything else
import opencons from 'opencons';
import { AppModule } from './app.module';
```

Alternatively, use the register hook directly:

```bash
node -r opencons/register-transform your-app.js
```

Or in code:

```javascript
require('opencons/register-transform')();
// ... rest of your imports
```

### Skipping a file

If you have a file you don't want instrumented, add this comment at the very top:

```javascript
// opencons-skip
```

---

## Database capture

Database queries appear in the trace graph as **blue fork nodes**, branching off the handler that triggered them. You can see the query, its timing, and exactly which handler was responsible.

Supported drivers:

| Driver | Package |
|---|---|
| Drizzle ORM | `drizzle-orm` |
| PostgreSQL | `pg` |
| MySQL | `mysql2` |
| MongoDB | `mongoose` |
| Prisma | `@prisma/client` |

**One important requirement:** load Opencons before you create your database clients. Otherwise, Opencons can't intercept the connection.

**About Drizzle + pg:** If you have `drizzle-orm` installed, Opencons captures at the ORM layer and automatically skips raw `pg`/`mysql2` to avoid logging duplicate queries.

You can opt individual drivers in or out:

```javascript
opencons.applyToNest(app, {
  drivers: {
    drizzle: true,
    mongoose: false, // disable if you don't use it
  },
});
```

---

## Widget API

The widget server exposes a small HTTP API for reading source code context in the graph. This is intentionally unauthenticated — it's for local development only.

### `GET /api/source`

Fetches a source snippet for a specific file and line, used when you click a branch node in the graph.

| Query param | Required | Description |
|---|---|---|
| `file` | Yes | Project-relative path or just the filename |
| `line` | No | 1-based line number (defaults to `1`) |

**Response shapes:**

| Status | Body |
|---|---|
| `200` | `{ file, line, startLine, lines: [{ number, text, highlight }] }` |
| `400` | `{ error, code: "MISSING_FILE_PARAM" }` |
| `404` | `{ error, code: "SOURCE_NOT_FOUND" }` |

### WebSocket protocol

Opencons streams live trace data over a WebSocket on the same port as the widget. You can connect to it directly if you want to build your own tooling on top.

Connect to: `ws://localhost:<port>`

**Sending a message:**

```json
{ "type": "get_history", "limit": 50 }
```

**Messages you'll receive:**

| Type | When it's sent |
|---|---|
| `trace_start` | A new request has just begun |
| `trace_update` | A request is in progress (live updates) |
| `trace` | A request has completed |
| `history` | Response to your `get_history` message |

---

## Trace data model

Every completed request produces a **directed acyclic graph (DAG)**. Here's what a trace looks like:

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
    { "id": "n1", "type": "request",    "label": "GET /api/users/1" },
    { "id": "n2", "type": "middleware", "label": "authMiddleware", "duration_ms": 0.5, "called_next": true },
    { "id": "n3", "type": "response",   "label": "200" }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" }
  ]
}
```

Each node represents a step in the request's execution. Edges connect them in the order they ran. The graph is what powers the visual in the widget — but it's also consumable directly if you want to run assertions in tests or pipe traces elsewhere.

---

## Running the example app

The repository includes an example Express app with auth middleware, a few routes, and some database interactions — a good way to see everything in action.

```bash
npm install
```

Start the app, then open the widget at **http://localhost:7331** and fire some requests at **http://localhost:3000**:

```bash
# Public route — no auth needed
curl http://localhost:3000/api/public

# Private route — try without auth first to see the 401
curl http://localhost:3000/api/users/42

# Same route with a valid token — watch the middleware chain change
curl -H "Authorization: Bearer dev" http://localhost:3000/api/users/42

# A POST with a body — to see request capture in action
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev" \
  -d '{"items":[1]}'
```

Watch the widget update in real time as each request completes.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the project locally, the coding conventions we follow, and how to run the test suite.

---

## License

MIT — see [LICENSE](LICENSE).
