# Contributing to Opencons

Thank you for helping improve Opencons. This guide covers local setup, project layout, conventions, and how to run tests.

## Prerequisites

- **Node.js** 18 or newer
- **npm** 9+ (ships with Node 18+)
- An Express 4.x application (or NestJS with `@nestjs/platform-express`) for manual testing

## Local setup

```bash
git clone <repository-url>
cd open-route
npm install
npm test
```

### Run the sample application

```bash
npm run start:example
```

Then open:

- Widget: http://localhost:7331
- Sample API: http://localhost:3000

Try the demo requests from the README **Run the Example** section.

### Link into your own project

```bash
# In open-route/
npm link

# In your Express/Nest project/
npm link opencons
```

Require `opencons` **before** `express()` and register the middleware **first**:

```javascript
const opencons = require('opencons');
const express = require('express');

const app = express();
app.use(opencons({ port: 7331 }));

## Project structure

```
open-route/
├── src/
│   ├── index.js              # Public entry — patches Express on import
│   ├── core/                 # Request middleware, tracer, ALS context
│   ├── lib/                  # Shared utilities (config, logger, errors)
│   ├── interceptors/         # Express + require-hook monkey patches
│   ├── transform/            # Babel AST branch probing
│   ├── store/                # In-memory trace buffer + source cache
│   ├── server/               # Widget HTTP + WebSocket servers
│   ├── drivers/              # Database driver patches
│   ├── integrations/         # NestJS helpers
│   └── utils/                # Consumer helpers (label, observable)
├── widget/                   # Browser dev UI (static assets)
├── examples/sample-app/      # Runnable Express demo
├── test/                     # Node.js built-in test runner
├── scripts/                  # Build/maintenance scripts
└── Opencons.d.ts         # TypeScript declarations
```

### Module responsibilities

| Module | Responsibility |
|--------|----------------|
| `core/` | Per-request trace lifecycle via AsyncLocalStorage |
| `lib/` | Cross-cutting config validation, logging, HTTP helpers |
| `interceptors/` | Wrap Express handlers without changing app code |
| `transform/` | Inject runtime probes into CommonJS `.js` files |
| `store/` | Ring buffer for traces; source snippets for widget peek |
| `server/` | Dev-only widget server (not for production exposure) |
| `drivers/` | Capture DB calls from patched drivers |

## Coding conventions

- **Language:** CommonJS (`'use strict'`), JSDoc for types
- **Style:** Match surrounding code — 2-space indent, single quotes, semicolons
- **Naming:** `camelCase` for functions/variables, `PascalCase` for classes
- **Logging:** Use `src/lib/logger.js` — never raw `console.*` in library code
- **Errors:** Throw typed errors from `src/lib/errors.js` for configuration/setup failures
- **Comments:** Explain non-obvious behaviour (monkey-patching, ALS, AST transforms) — not what the code literally does
- **Scope:** Keep changes focused; avoid drive-by refactors

### Design constraints

Opencons is a **development-only** library. Do not add features that encourage production deployment without explicit guards.

- Singleton initialisation is intentional (first `opencons()` call wins). Document behaviour when changing it.
- Express prototype patching runs on `require('opencons')` so handlers registered later are wrapped automatically.
- The widget server has **no authentication** — acceptable only for local development.

## Environment variables

See [.env.example](.env.example). Host applications must load `.env` **before** importing Opencons when using transform env vars.

| Variable | Purpose |
|----------|---------|
| `NODE_ENV=production` | Disables tracing (unless `enabled: true`) |
| `OPENCONS_TRANSFORM=1` | Install AST require hook on import |
| `OPENCONS_ROOT` | Project root for transforms |
| `OPENCONS_TRANSFORM_EXCLUDE` | Comma-separated skip globs |
| `OPENCONS_LOG_LEVEL` | `info` (default) or `debug` |

## Running tests

```bash
npm test
```

Tests use Node's built-in runner (`node --test`). Add new test files under `test/` with the `*.test.js` suffix.

### What to test

- Tracer graph building and store behaviour
- Express/Nest integration paths
- AST transforms and probe runtime
- Config validation and edge cases
- Driver detection (mocked where possible)

Widget UI is not yet covered by automated browser tests.

## Pull request checklist

- [ ] `npm test` passes locally
- [ ] New behaviour has tests when practical
- [ ] README / CONTRIBUTING updated if public API or setup changed
- [ ] No secrets or `.env` files committed
- [ ] Changes are dev-only safe (no production footguns)

## Reporting issues

Include:

- Node.js version
- Express or NestJS version
- Minimal reproduction steps
- Whether `OPENCONS_TRANSFORM` is enabled
- Relevant log output (`OPENCONS_LOG_LEVEL=debug`)
