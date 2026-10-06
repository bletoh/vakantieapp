// Start de app met een lege, tijdelijke database en geef een kleine HTTP-client terug.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-test-'));
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* nog niet gestart */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    dataDir: dir,
    log: () => log,
    async stop() {
      proc.kill('SIGTERM');
      await new Promise((r) => proc.once('exit', r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Eén gebruiker met eigen cookie en (optioneel) actieve groep.
function client(base) {
  let cookie = '';
  const c = {
    team: null,
    async req(method, url, body, headers = {}) {
      const res = await fetch(base + url, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(c.team ? { 'X-Team': String(c.team) } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    },
  };
  return c;
}

module.exports = { startServer, client };
