'use strict';

const path = require('path');
const opencons = require('../../src/index');
const express = require('express');

const PORT = Number(process.env.EXAMPLE_PORT) || 3000;

const app = express();

app.use(
  opencons({
    port: Number(process.env.OPENCONS_PORT) || 7331,
    transform: {
      enabled: process.env.OPENCONS_TRANSFORM === '1',
      projectRoot: path.join(__dirname),
    },
  })
);

app.use(express.json());
app.use('/api', require('./routes/api'));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[sample-app] API → http://localhost:${PORT}`);
  console.log('[sample-app] Widget → http://localhost:7331');
});
