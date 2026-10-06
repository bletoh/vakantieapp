// Controleert of de samengevoegde app (public/js/app/*.js) geldige JavaScript is.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildApp } = require('../src/bundle');

const { code, files } = buildApp();
const tmp = path.join(os.tmpdir(), `vp-app-${process.pid}.js`);
fs.writeFileSync(tmp, code);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
  console.log(`app.js ok (${files.length} bestanden, ${code.split('\n').length} regels)`);
} finally {
  fs.unlinkSync(tmp);
}
