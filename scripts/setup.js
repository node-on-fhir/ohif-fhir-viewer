#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXTENSION_DIR = path.resolve(__dirname, '..');
const VIEWERS_ROOT = path.resolve(EXTENSION_DIR, '../..');
const MODES_DIR = path.join(VIEWERS_ROOT, 'modes');
const MODE_TARGET = path.join(MODES_DIR, 'fhir-viewer');
const MODE_SOURCE = path.join(EXTENSION_DIR, 'mode');
const PLUGIN_CONFIG = path.join(VIEWERS_ROOT, 'platform', 'app', 'pluginConfig.json');
const WEBPACK_PWA = path.join(VIEWERS_ROOT, 'platform', 'app', '.webpack', 'webpack.pwa.js');

const EXTENSION_ENTRY = {
  packageName: '@ohif/extension-nof-ohif-viewer',
  version: '0.0.1',
};

const MODE_ENTRY = {
  packageName: 'fhir-viewer',
};

// ---------------------------------------------------------------------------
// 1. Copy mode
// ---------------------------------------------------------------------------

function copyMode() {
  if (fs.existsSync(MODE_TARGET)) {
    console.log('[skip] modes/fhir-viewer/ already exists');
    return false;
  }

  if (!fs.existsSync(MODE_SOURCE)) {
    console.error('[error] mode/ directory not found in extension — cannot copy');
    process.exit(1);
  }

  fs.cpSync(MODE_SOURCE, MODE_TARGET, { recursive: true });
  console.log('[done] Copied mode/ → modes/fhir-viewer/');
  return true;
}

// ---------------------------------------------------------------------------
// 2. Patch pluginConfig.json
// ---------------------------------------------------------------------------

function patchPluginConfig() {
  if (!fs.existsSync(PLUGIN_CONFIG)) {
    console.error('[error] pluginConfig.json not found at ' + PLUGIN_CONFIG);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(PLUGIN_CONFIG, 'utf8'));
  let changed = false;

  // Ensure arrays exist
  if (!Array.isArray(config.extensions)) config.extensions = [];
  if (!Array.isArray(config.modes)) config.modes = [];

  // Add extension entry if missing
  const hasExtension = config.extensions.some(
    e => e.packageName === EXTENSION_ENTRY.packageName
  );
  if (!hasExtension) {
    config.extensions.push(EXTENSION_ENTRY);
    console.log('[done] Added extension entry to pluginConfig.json');
    changed = true;
  } else {
    console.log('[skip] Extension entry already in pluginConfig.json');
  }

  // Add mode entry if missing
  const hasMode = config.modes.some(
    m => m.packageName === MODE_ENTRY.packageName
  );
  if (!hasMode) {
    config.modes.push(MODE_ENTRY);
    console.log('[done] Added mode entry to pluginConfig.json');
    changed = true;
  } else {
    console.log('[skip] Mode entry already in pluginConfig.json');
  }

  if (changed) {
    fs.writeFileSync(PLUGIN_CONFIG, JSON.stringify(config, null, 2) + '\n');
  }
}

// ---------------------------------------------------------------------------
// 3. Patch webpack dev server proxy (add /fhir-proxy entry)
// ---------------------------------------------------------------------------

function patchWebpackProxy() {
  if (!fs.existsSync(WEBPACK_PWA)) {
    console.error('[error] webpack.pwa.js not found at ' + WEBPACK_PWA);
    process.exit(1);
  }

  let content = fs.readFileSync(WEBPACK_PWA, 'utf8');

  if (content.includes("context: ['/fhir-proxy']")) {
    console.log('[skip] /fhir-proxy proxy entry already in webpack.pwa.js');
    return;
  }

  const fhirProxyTarget = process.env.FHIR_PROXY_TARGET || 'http://localhost:3200';

  const FHIR_PROXY_BLOCK = [
    '        {',
    "          context: ['/fhir-proxy'],",
    `          target: '${fhirProxyTarget}',`,
    '          changeOrigin: true,',
    "          pathRewrite: { '^/fhir-proxy': '' },",
    '        },',
  ].join('\n');

  // Find the /dicomweb proxy block's closing "}," and insert after it.
  // The pattern: the line with "context: ['/dicomweb']" is inside a block
  // that ends with "},". We look for that block's closing brace-comma.
  const dicomwebIdx = content.indexOf("context: ['/dicomweb']");
  if (dicomwebIdx === -1) {
    console.error('[error] Could not find /dicomweb proxy entry in webpack.pwa.js');
    console.error('        Please add the /fhir-proxy proxy block manually.');
    return;
  }

  // Find the closing "}," after the /dicomweb context line
  const closingIdx = content.indexOf('},', dicomwebIdx);
  if (closingIdx === -1) {
    console.error('[error] Could not find closing }, for /dicomweb proxy block');
    return;
  }

  // Insert the fhir-proxy block after the "}," (plus the newline)
  const insertPos = closingIdx + 2; // after "},"
  const before = content.slice(0, insertPos);
  const after = content.slice(insertPos);
  content = before + '\n' + FHIR_PROXY_BLOCK + after;

  fs.writeFileSync(WEBPACK_PWA, content);
  console.log('[done] Added /fhir-proxy proxy entry to webpack.pwa.js (target: ' + fhirProxyTarget + ')');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('');
console.log('ohif-viewer extension setup');
console.log('==========================');
console.log('');

copyMode();
patchPluginConfig();
patchWebpackProxy();

console.log('');
console.log('Next steps:');
console.log('  cd ' + VIEWERS_ROOT);
console.log('  yarn install');
console.log('  yarn dev');
console.log('');
