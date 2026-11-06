'use strict';
// Parallel-safety evidence: N runs started at the same moment, each with its own RUN_ID and
// its own app instance on its own port. Results go to evidence/parallel-run-log.md.
const fs = require('fs');
const path = require('path');
const runOnce = require('./run-once');

(async () => {
  const n = Number(process.argv[2] || 3);
  const logFile = path.join(__dirname, '../evidence/parallel-run-log.md');
  const stamp = new Date().toISOString();
  const ids = Array.from({ length: n }, (_, i) => `parallel-${stamp.replace(/[:.]/g, '').slice(0, 15)}-${String.fromCharCode(65 + i)}`);
  const started = Date.now();
  const results = await Promise.all(ids.map((id) => runOnce(id)));
  const wall = ((Date.now() - started) / 1000).toFixed(1);
  let md = `\n## Parallel batch ${stamp} (${n} runs started simultaneously, wall clock ${wall}s)\n\n| RUN_ID | App port | Result | Duration | Tests |\n|---|---|---|---|---|\n`;
  results.forEach((r, i) => {
    const port = (r.output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/) || [])[1]
      || (fs.existsSync(path.join(__dirname, `../evidence/${ids[i]}/run.log`)) ? 'see run.log' : '?');
    const summary = (r.output.match(/(\d+) passed/) || [])[0] || 'n/a';
    md += `| ${ids[i]} | ${port} | ${r.ok ? 'GREEN' : 'RED'} | ${(r.ms / 1000).toFixed(1)}s | ${summary} |\n`;
    if (!r.ok) fs.writeFileSync(path.join(__dirname, `../evidence/${ids[i]}/console-output.txt`), r.output);
  });
  const allOk = results.every((r) => r.ok);
  md += `\n**${allOk ? 'All runs green, no interference.' : 'At least one run failed.'}**\n`;
  fs.appendFileSync(logFile, md);
  process.stdout.write(md);
  process.exit(allOk ? 0 : 1);
})();
