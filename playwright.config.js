const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.OHIF_URL || 'http://localhost:3000',
    headless: true,
    // Use the installed Google Chrome so `playwright install` (and its CDN
    // download) is not required. Unset via PW_CHANNEL='' to use bundled chromium.
    channel: process.env.PW_CHANNEL !== undefined ? process.env.PW_CHANNEL : 'chrome',
  },
});
