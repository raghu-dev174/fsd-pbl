const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const autocannon = require('autocannon');

const root = path.resolve(__dirname, '..');
const resultsDir = path.join(root, 'results');
const port = 3200;
const url = `http://127.0.0.1:${port}/api/poll?since=999999&clientId=autocannon`;
fs.mkdirSync(resultsDir, { recursive: true });

async function ready() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await wait(100);
  }
  throw new Error('Autocannon server did not start.');
}

async function main() {
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  try {
    await ready();
    const result = await autocannon({ url, connections: 100, duration: 10, pipelining: 1 });
    fs.writeFileSync(path.join(resultsDir, 'autocannon-short-polling.json'), JSON.stringify(result, null, 2));
    const text = [
      'AUTOCANNON HTTP CAPACITY CHECK',
      `Target: ${url}`,
      'Connections: 100',
      'Duration: 10 seconds',
      `Average requests/sec: ${result.requests.average}`,
      `Average latency: ${result.latency.average} ms`,
      `p99 latency: ${result.latency.p99} ms`,
      `Throughput: ${result.throughput.average} bytes/sec`,
      '',
      'This is a capacity check for the ordinary short-poll endpoint. It is not used in the controlled transport comparison.'
    ].join('\n');
    fs.writeFileSync(path.join(resultsDir, 'autocannon-summary.txt'), text);
    console.log(text);
  } finally {
    child.kill('SIGTERM');
    await wait(300);
    fs.writeFileSync(path.join(resultsDir, 'autocannon-server.log'), Buffer.concat(chunks));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
