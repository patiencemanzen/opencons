'use strict';

/**
 * Copy D3 into widget/vendor so the dev widget works offline.
 * Falls back to CDN in index.html when this file is missing.
 */

const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'node_modules', 'd3', 'dist', 'd3.min.js');
const targetDir = path.join(__dirname, '..', 'widget', 'vendor');
const target = path.join(targetDir, 'd3.min.js');

if (!fs.existsSync(source)) {
  console.warn('[vendor-d3] d3 not installed — widget will use CDN fallback');
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log('[vendor-d3] Copied d3.min.js to widget/vendor/');
