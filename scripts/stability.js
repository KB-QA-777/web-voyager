'use strict';
// Stability evidence: N consecutive headless runs, each appended to evidence/stability-run-log.md.
const fs = require('fs');
const path = require('path');
const runOnce = require('./run-once');

(async () => {
  const n = Number(process.argv[2] || 10);
  const logFile = path.join(__dirname, '../evidence/stability-run-log.md');
  const stamp = new Date().toISOString();
  fs.appendFileSync(logFile, `\n## Stability batch ${stamp} (${n} consecutive headless runs)\n\n| # | RUN_ID | Result | Duration | Tests |\n|---|---|---|---|---|\n`);
  let green = 0;
  for (let i = 1; i <= n; i++) {
    const runId = `stability-${stamp.replace(/[:.]/g, '').slice(0, 15)}-${String(i).padStart(2, '0')}`;
    const r = await runOnce(runId);
    const summary = (r.output.match(/(\d+) passed/) || [])[0] || 'n/a';
    const failed = (r.output.match(/(\d+) failed/) || [])[0];
    const row = `| ${i} | ${runId} | ${r.ok ? 'GREEN' : 'RED'} | ${(r.ms / 1000).toFixed(1)}s | ${summary}${failed ? ', ' + failed : ''} |\n`;
    fs.appendFileSync(logFile, row);
    process.stdout.write(row);
    if (r.ok) green++;
    else fs.writeFileSync(path.join(__dirname, `../evidence/${runId}/console-output.txt`), r.output);
  }
  fs.appendFileSync(logFile, `\n**${green}/${n} consecutive green.**\n`);
  process.exit(green === n ? 0 : 1);
})();
