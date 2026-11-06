'use strict';
// Runs the suite once with a given RUN_ID and returns { ok, ms, output }.
const { spawn } = require('child_process');
const path = require('path');
module.exports = function runOnce(runId, extraEnv = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    const child = spawn(process.execPath, [path.join(__dirname, '../node_modules/@playwright/test/cli.js'), 'test'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, RUN_ID: runId, ...extraEnv },
    });
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ ok: code === 0, code, ms: Date.now() - started, output }));
  });
};
