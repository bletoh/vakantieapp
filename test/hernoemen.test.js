const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { startServer, client } = require('./helpers');

test('oude database vakantieplanner.db wordt bij het starten reismannetje.db', async () => {
  // Eerst een gewone database met een account maken, dan teruggeven onder de oude naam.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-oud-'));
  let srv = await startServer({ DATA_DIR: dir });
  await client(srv.base).req('POST', '/api/auth/register', { name: 'Oudgediende', password: 'geheim1234' });
  await srv.stop();
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(path.join(dir, `reismannetje.db${ext}`))) fs.renameSync(path.join(dir, `reismannetje.db${ext}`), path.join(dir, `vakantieplanner.db${ext}`));
  }
  srv = await startServer({ DATA_DIR: dir });
  try {
    assert.ok(!fs.existsSync(path.join(dir, 'vakantieplanner.db')));
    const users = new Database(path.join(dir, 'reismannetje.db'), { readonly: true }).prepare('SELECT name FROM users').all();
    assert.deepEqual(users.map((u) => u.name), ['Oudgediende']);
  } finally { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
