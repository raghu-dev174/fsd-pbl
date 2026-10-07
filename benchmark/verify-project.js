const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'server/index.js', 'server/notification-source.js', 'client/src/main.jsx',
  'benchmark/run-benchmarks.js', 'benchmark/run-autocannon.js',
  'results/short-polling.json', 'results/long-polling.json', 'results/sse.json',
  'results/summary.json', 'charts/requests-per-minute.png', 'charts/cpu-usage.png',
  'charts/delivery-delay.png', 'README.md',
  'report/FSD_Internal_2_Real_Time_Transport_Report.docx',
  'report/FSD_Internal_2_Real_Time_Transport_Report.pdf'
];

let failed = false;
for (const relative of required) {
  const full = path.join(root, relative);
  const ok = fs.existsSync(full) && fs.statSync(full).size > 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${relative}`);
  if (!ok) failed = true;
}

if (fs.existsSync(path.join(root, 'results', 'summary.json'))) {
  const summary = JSON.parse(fs.readFileSync(path.join(root, 'results', 'summary.json'), 'utf8'));
  for (const [key, row] of Object.entries(summary.transports)) {
    const checks = {
      clientCount100: row.configuration.clientCount === 100,
      hasRequests: row.totalRequests > 0,
      hasDeliveries: row.deliveryDelayMs.count > 0,
      hasCpuSamples: row.cpuSampleCount > 0
    };
    for (const [name, ok] of Object.entries(checks)) {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${key}.${name}`);
      if (!ok) failed = true;
    }
  }
}

if (failed) process.exitCode = 1;
else console.log('All deliverable and measurement checks passed.');
