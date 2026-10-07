const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { NotificationSource } = require('./notification-source');
const { Metrics } = require('./metrics');

const app = express();
const port = Number(process.env.PORT || 3000);
const notificationIntervalMs = Number(process.env.NOTIFICATION_INTERVAL_MS || 2000);
const longPollTimeoutMs = Number(process.env.LONG_POLL_TIMEOUT_MS || 15000);
const source = new NotificationSource(notificationIntervalMs);
const metrics = new Metrics();
const longPollWaiters = new Set();
const sseClients = new Map();

app.disable('x-powered-by');
app.use(express.json());

function parseSince(req) {
  const value = Number(req.query.since || req.get('Last-Event-ID') || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finishLongPoll(waiter, notifications, reason) {
  if (waiter.finished) return;
  waiter.finished = true;
  clearTimeout(waiter.timer);
  longPollWaiters.delete(waiter);
  const durationMs = Date.now() - waiter.startedAt;
  metrics.connectionClose('longPoll', durationMs);
  metrics.dispatch('longPoll', notifications.length);
  waiter.res.json({ notifications, reason, waitedMs: durationMs, clientId: waiter.clientId });
}

source.on('notification', (notification) => {
  metrics.notificationsGenerated += 1;
  for (const waiter of [...longPollWaiters]) {
    if (notification.id > waiter.since) finishLongPoll(waiter, [notification], 'notification');
  }
  const payload = `id: ${notification.id}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`;
  for (const client of sseClients.values()) {
    client.res.write(payload);
    metrics.dispatch('sse', 1);
  }
});

app.get('/api/health', (_req, res) => {
  metrics.request('other');
  res.json({ ok: true, now: Date.now(), notificationIntervalMs });
});

app.get('/api/poll', (req, res) => {
  const openedAt = Date.now();
  metrics.request('poll');
  metrics.connectionOpen('poll');
  const notifications = source.since(parseSince(req));
  metrics.dispatch('poll', notifications.length);
  res.json({ notifications, clientId: req.query.clientId || null, polledAt: Date.now() });
  metrics.connectionClose('poll', Date.now() - openedAt);
});

app.get('/api/long-poll', (req, res) => {
  metrics.request('longPoll');
  metrics.connectionOpen('longPoll');
  const since = parseSince(req);
  const available = source.since(since);
  if (available.length > 0) {
    metrics.dispatch('longPoll', available.length);
    metrics.connectionClose('longPoll', 0);
    return res.json({ notifications: available, reason: 'backlog', waitedMs: 0, clientId: req.query.clientId || null });
  }

  const waiter = {
    res,
    since,
    clientId: req.query.clientId || null,
    startedAt: Date.now(),
    finished: false,
    timer: null
  };
  waiter.timer = setTimeout(() => finishLongPoll(waiter, [], 'timeout'), longPollTimeoutMs);
  longPollWaiters.add(waiter);
  req.on('close', () => {
    if (!waiter.finished) {
      waiter.finished = true;
      clearTimeout(waiter.timer);
      longPollWaiters.delete(waiter);
      metrics.connectionClose('longPoll', Date.now() - waiter.startedAt);
    }
  });
});

app.get('/api/events', (req, res) => {
  metrics.request('sse');
  metrics.connectionOpen('sse');
  const clientId = String(req.query.clientId || `sse-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const startedAt = Date.now();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ clientId, connectedAt: Date.now() })}\n\n`);
  const missed = source.since(parseSince(req));
  for (const item of missed) {
    res.write(`id: ${item.id}\nevent: notification\ndata: ${JSON.stringify(item)}\n\n`);
  }
  metrics.dispatch('sse', missed.length);
  const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 10000);
  sseClients.set(clientId, { res, startedAt, heartbeat });
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
    metrics.connectionClose('sse', Date.now() - startedAt);
  });
});

app.post('/api/admin/reset', (req, res) => {
  const mode = String(req.body?.mode || 'benchmark');
  for (const waiter of [...longPollWaiters]) finishLongPoll(waiter, [], 'reset');
  source.reset();
  metrics.reset(mode);
  res.json({ ok: true, mode, resetAt: Date.now() });
});

app.get('/api/admin/metrics', (_req, res) => res.json(metrics.snapshot()));

app.get('/api/results', (_req, res) => {
  const summaryPath = path.join(__dirname, '..', 'results', 'summary.json');
  if (!fs.existsSync(summaryPath)) return res.status(404).json({ error: 'Run npm run benchmark first.' });
  res.sendFile(summaryPath);
});

app.get('/api/autocannon', (_req, res) => {
  const summaryPath = path.join(__dirname, '..', 'results', 'autocannon-summary.txt');
  if (!fs.existsSync(summaryPath)) return res.status(404).type('text').send('Run npm run autocannon first.');
  res.type('text').sendFile(summaryPath);
});

app.get('/api/project-structure', (_req, res) => {
  const root = path.join(__dirname, '..');
  const ignored = new Set(['node_modules', 'dist', 'qa', '.capture']);
  const lines = ['realtime-transport-pbl/'];
  function walk(directory, prefix = '', depth = 0) {
    if (depth > 2) return;
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !ignored.has(entry.name) && !entry.name.startsWith('.'))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    entries.forEach((entry, index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory()) walk(path.join(directory, entry.name), `${prefix}${last ? '    ' : '│   '}`, depth + 1);
    });
  }
  walk(root);
  res.type('text').send(lines.join('\n'));
});

app.use('/charts', express.static(path.join(__dirname, '..', 'charts')));
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*splat', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

source.start();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Real-time transport server listening at http://127.0.0.1:${port}`);
  console.log(`Notification interval: ${notificationIntervalMs} ms`);
});

function shutdown() {
  source.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
