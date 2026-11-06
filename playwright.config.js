'use strict';
const { defineConfig } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// One RUN_ID per invocation: it tags every log line, screenshot and report so parallel runs
// can be told apart. Callers (scripts/stability.js, scripts/parallel.js) set it explicitly.
const RUN_ID = process.env.RUN_ID || `run-${Date.now().toString(36)}-${process.pid}`;
process.env.RUN_ID = RUN_ID;

// Each run gets its own app process on its own free port -> no shared state between runs.
const APP_PORT = process.env.APP_PORT || execFileSync(process.execPath, [path.join(__dirname, 'scripts/free-port.js')]).toString().trim();
process.env.APP_PORT = APP_PORT;

const EVIDENCE_DIR = path.join(__dirname, 'evidence', RUN_ID);
process.env.EVIDENCE_DIR = EVIDENCE_DIR;
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// The cloud sandbox ships Chromium at a fixed path; on a normal machine Playwright finds its own.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};

module.exports = defineConfig({
  testDir: './tests',
  // All tests share the one ticket TCK-101 (as in the brief), so inside a run they execute serially.
  // Isolation BETWEEN runs comes from the per-run app instance.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(EVIDENCE_DIR, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(EVIDENCE_DIR, 'results.json') }],
    ['html', { outputFolder: path.join(EVIDENCE_DIR, 'html-report'), open: 'never' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions,
  },
  webServer: {
    command: `node app/server.js`,
    url: `http://127.0.0.1:${APP_PORT}/health`,
    env: { APP_PORT },
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
