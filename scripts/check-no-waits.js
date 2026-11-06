'use strict';
// Code-review gate for the "No fixed waits" requirement: fails if any test or fixture code
// contains a fixed wait. Run with `npm run check:no-waits`.
const fs = require('fs');
const path = require('path');
const banned = /\b(waitForTimeout|sleep|setTimeout|setInterval|delay)\s*\(/;
const roots = ['tests', 'lib'];
let hits = 0;
for (const root of roots) {
  for (const f of fs.readdirSync(path.join(__dirname, '..', root))) {
    const file = path.join(__dirname, '..', root, f);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (banned.test(line)) { hits++; console.log(`${root}/${f}:${i + 1}: ${line.trim()}`); }
    });
  }
}
if (hits) { console.error(`\n${hits} fixed wait(s) found.`); process.exit(1); }
console.log('OK: no waitForTimeout / sleep / setTimeout in tests or fixtures.');
