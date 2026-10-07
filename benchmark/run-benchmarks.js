const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const { numericSummary } = require('./statistics');

const root = path.resolve(__dirname, '..');
const resultsDir = path.join(root, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const arg = (name, fallback) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? Number(found.split('=')[1]) : fallback;
};
const durationMs = arg('duration', 120000);
const baselineMs = arg('baseline', 10000);
const clientCount = arg('clients', 100);
const pollIntervalMs = 5000;
const notificationIntervalMs = 2000;
const port = arg('port', 3100);
const baseUrl = `http://127.0.0.1:${port}`;

function recordNotification(deliveries, clientId, notification) {
  const receivedAt = Date.now();
  deliveries.push({
    clientId,
    notificationId: notification.id,
    generatedAt: notification.generatedAt,
    receivedAt,
    delayMs: receivedAt - notification.generatedAt
  });
}

async function shortPollingClient(index, deadline, deliveries) {
  const clientId = `short-${String(index + 1).padStart(3, '0')}`;
  let since = 0;
  while (Date.now() < deadline) {
    const cycleStarted = Date.now();
    const response = await fetch(`${baseUrl}/api/poll?since=${since}&clientId=${clientId}`);
    const body = await response.json();
    for (const notification of body.notifications) {
      since = Math.max(since, notification.id);
      recordNotification(deliveries, clientId, notification);
    }
    const remaining = Math.min(Math.max(0, deadline - Date.now()), Math.max(0, pollIntervalMs - (Date.now() - cycleStarted)));
    if (remaining > 0) await wait(remaining);
  }
}

async function longPollingClient(index, deadline, deliveries, controllers) {
  const clientId = `long-${String(index + 1).padStart(3, '0')}`;
  let since = 0;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const response = await fetch(`${baseUrl}/api/long-poll?since=${since}&clientId=${clientId}`, { signal: controller.signal });
      const body = await response.json();
      for (const notification of body.notifications) {
        since = Math.max(since, notification.id);
        recordNotification(deliveries, clientId, notification);
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    } finally {
      controllers.delete(controller);
    }
  }
}

async function consumeSseStream(response, clientId, deliveries, deadline) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    if (Date.now() >= deadline) break;
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const eventLine = frame.split('\n').find((line) => line.startsWith('event:'));
      const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
      if (eventLine?.includes('notification') && dataLine) {
        recordNotification(deliveries, clientId, JSON.parse(dataLine.slice(5).trim()));
      }
    }
  }
}

async function sseClient(index, deadline, deliveries, controllers) {
  const clientId = `sse-${String(index + 1).padStart(3, '0')}`;
  const controller = new AbortController();
  controllers.add(controller);
  try {
    const response = await fetch(`${baseUrl}/api/events?since=0&clientId=${clientId}`, { signal: controller.signal });
    await consumeSseStream(response, clientId, deliveries, deadline);
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    controllers.delete(controller);
  }
}

async function waitForServer(serverProcess) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server exited before becoming ready (exit code ${serverProcess.exitCode}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error('Server did not become ready.');
}

async function resetMetrics(mode) {
  const response = await fetch(`${baseUrl}/api/admin/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode })
  });
  if (!response.ok) throw new Error(`Reset failed for ${mode}`);
}

async function getMetrics() {
  return fetch(`${baseUrl}/api/admin/metrics`).then((response) => response.json());
}

function startServer(mode) {
  const logPath = path.join(resultsDir, `server-${mode}.log`);
  const log = fs.createWriteStream(logPath);
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NOTIFICATION_INTERVAL_MS: String(notificationIntervalMs) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { log.write(chunk); process.stdout.write(`[server:${mode}] ${chunk}`); });
  child.stderr.on('data', (chunk) => { log.write(chunk); process.stderr.write(`[server:${mode}] ${chunk}`); });
  child.on('error', (error) => { log.write(`${error.stack}\n`); process.stderr.write(`${error.stack}\n`); });
  child.on('exit', (code, signal) => log.write(`Server exited with code=${code} signal=${signal}\n`));
  return { child, log, logPath };
}

async function runTransport(mode) {
  const server = startServer(mode);
  try {
    await waitForServer(server.child);
    await resetMetrics(`${mode}-baseline`);
    await wait(baselineMs);
    const baselineMetrics = await getMetrics();

    await resetMetrics(mode);
    const startedAt = Date.now();
    const deadline = startedAt + durationMs;
    const deliveries = [];
    const controllers = new Set();
    let clientTasks;
    if (mode === 'short-polling') {
      clientTasks = Array.from({ length: clientCount }, (_, index) => shortPollingClient(index, deadline, deliveries));
    } else if (mode === 'long-polling') {
      clientTasks = Array.from({ length: clientCount }, (_, index) => longPollingClient(index, deadline, deliveries, controllers));
    } else {
      clientTasks = Array.from({ length: clientCount }, (_, index) => sseClient(index, deadline, deliveries, controllers));
    }
    const abortTimer = setTimeout(() => controllers.forEach((controller) => controller.abort()), durationMs + 250);
    await Promise.all(clientTasks);
    clearTimeout(abortTimer);
    const finishedAt = Date.now();
    await wait(250);
    const serverMetrics = await getMetrics();
    const requestKey = mode === 'short-polling' ? 'poll' : mode === 'long-polling' ? 'longPoll' : 'sse';
    const actualDurationMs = finishedAt - startedAt;
    const delayStats = numericSummary(deliveries.map((item) => item.delayMs));
    const cpuStats = numericSummary(serverMetrics.cpuSamples.map((item) => item.percentOneCore));
    const baselineCpuStats = numericSummary(baselineMetrics.cpuSamples.map((item) => item.percentOneCore));
    const connectionStats = numericSummary(serverMetrics.connectionDurationsMs[requestKey] || []);
    const result = {
      transport: mode,
      configuration: { clientCount, requestedDurationMs: durationMs, actualDurationMs, pollIntervalMs, notificationIntervalMs, baselineMs },
      timing: { startedAt, finishedAt },
      summary: {
        totalRequests: serverMetrics.requestCounts[requestKey],
        requestsPerMinute: serverMetrics.requestCounts[requestKey] / (actualDurationMs / 60000),
        deliveryDelayMs: delayStats,
        averageCpuPercent: cpuStats.average,
        peakCpuPercent: cpuStats.max,
        baselineAverageCpuPercent: baselineCpuStats.average,
        peakActiveConnections: serverMetrics.peakConnections[requestKey],
        averageConnectionDurationMs: connectionStats.average,
        notificationsGenerated: serverMetrics.notificationsGenerated,
        deliverySamples: deliveries.length
      },
      baselineMetrics,
      serverMetrics,
      deliveries
    };
    const outputPath = path.join(resultsDir, `${mode}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`${mode}: ${result.summary.totalRequests} requests, ${result.summary.requestsPerMinute.toFixed(1)} req/min, ${delayStats.average.toFixed(1)} ms average delay`);
    return result;
  } finally {
    server.child.kill('SIGTERM');
    await wait(500);
    server.log.end();
  }
}

async function main() {
  console.log(`Controlled benchmark: ${clientCount} clients, ${durationMs / 1000}s per transport, notification every ${notificationIntervalMs}ms`);
  const shortPolling = await runTransport('short-polling');
  const longPolling = await runTransport('long-polling');
  const sse = await runTransport('sse');
  const map = (label, result) => ({
    label,
    ...result.summary,
    configuration: result.configuration,
    cpuSampleCount: result.serverMetrics.cpuSamples.length
  });
  const summary = {
    generatedAt: new Date().toISOString(),
    configuration: { clientCount, durationSeconds: durationMs / 1000, notificationIntervalMs, pollIntervalMs, baselineSeconds: baselineMs / 1000 },
    methodology: {
      requests: 'Counted at the server endpoint during the measured interval.',
      cpu: 'Node process.cpuUsage sampled once per second and divided by elapsed wall-clock time; percent of one logical CPU core.',
      deliveryDelay: 'Client receipt timestamp minus server generatedAt timestamp, in milliseconds.',
      concurrency: '100 asynchronous client loops/streams started together in one Node.js simulator process.'
    },
    transports: {
      shortPolling: map('Short Polling', shortPolling),
      longPolling: map('Long Polling', longPolling),
      sse: map('Server-Sent Events', sse)
    }
  };
  fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(resultsDir, 'system-metrics.json'), JSON.stringify({
    generatedAt: summary.generatedAt,
    cpuMethodology: summary.methodology.cpu,
    shortPolling: shortPolling.serverMetrics.cpuSamples,
    longPolling: longPolling.serverMetrics.cpuSamples,
    sse: sse.serverMetrics.cpuSamples
  }, null, 2));
  console.log(`Summary written to ${path.join(resultsDir, 'summary.json')}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
