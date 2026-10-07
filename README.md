# Real-Time Transport Lab

FSD Internal 2, Assignment 19 compares short polling, long polling, and Server-Sent Events (SSE) using one shared notification source and 100 concurrent simulated clients.

The project includes a React demonstration UI, a Node.js server, repeatable benchmarks, raw per-delivery data, charts, screenshots, and a final DOCX/PDF report.

## Architecture

```text
Shared notification generator (one update every 2 seconds)
                         |
          +--------------+--------------+
          |              |              |
     GET /api/poll  GET /api/long-poll  GET /api/events
       every 5 s      held until event    SSE stream
          |              |              |
          +--------------+--------------+
                         |
          React UI or 100-client simulator
```

Every notification contains an `id`, `message`, `generatedAt` Unix timestamp, and ISO `timestamp`. All three transports receive notifications produced by the same `NotificationSource` instance.

## Requirements

- Node.js 20 or newer (measured with Node.js 24.18.0)
- npm
- A current browser with the EventSource API
- Python with Pillow only if regenerating the charts

## Install and run

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3000`.

For separate development servers with hot reload:

```bash
npm run dev
```

The React development UI runs at `http://127.0.0.1:5173` and proxies API calls to the Node server on port 3000.

## Transport behavior

### Short polling

Select **Short Polling** in the UI. The browser requests `GET /api/poll` immediately and then once every 5 seconds. Each response includes all notifications newer than the client's last received ID.

### Long polling

Select **Long Polling**. The browser calls `GET /api/long-poll`; the server holds the HTTP request until a notification is generated or the 15-second timeout expires. The client reconnects immediately after every response.

### Server-Sent Events

Select **Server-Sent Events**. The React client creates a browser `EventSource` for `GET /api/events`. The server sets the SSE headers, sends notifications over the persistent stream, writes a heartbeat every 10 seconds, and removes disconnected clients.

## Controlled 100-client benchmark

Run the final experiment:

```bash
npm run benchmark
```

This performs three sequential, isolated tests:

- 100 short-polling client loops
- 100 genuine long-poll request loops
- 100 persistent SSE streams

Each test runs for 120 seconds, uses one notification every 2 seconds, and has a 10-second idle baseline. The simulator starts 100 asynchronous client tasks together; it does not send requests sequentially.

A faster validation run is available:

```bash
npm run benchmark:quick
```

## Measurements

- **Requests per minute:** server-side endpoint counter divided by actual measured duration.
- **Server CPU:** `process.cpuUsage()` sampled once per second and divided by elapsed wall-clock time. Values are percent of one logical CPU core.
- **Delivery delay:** `clientReceivedTimestamp - notification.generatedAt` for every client delivery.
- **Connections:** current and peak open connections measured by the server. Long-poll connection durations and SSE stream durations are retained.

Raw files are written to `results/`. The detailed transport files contain configuration, server samples, connection durations, and every per-client delivery measurement.

## Measured results

Final run: 100 concurrent clients, 120 seconds per transport, notification every 2 seconds, Windows, Node.js 24.18.0.

| Metric | Short Polling | Long Polling | SSE |
| --- | ---: | ---: | ---: |
| Total HTTP requests | 2,400 | 6,000 | 100 |
| Requests per minute | 1,199.8 | 2,992.2 | 49.9 |
| Average CPU (% of one core) | 2.05% | 2.57% | 0.87% |
| Peak CPU (% of one core) | 23.40% | 10.99% | 20.24% |
| Average delivery delay | 2,401.8 ms | 39.0 ms | 6.4 ms |
| Median delivery delay | 2,163.0 ms | 36.0 ms | 6.0 ms |
| Minimum delivery delay | 2 ms | 1 ms | 0 ms |
| Maximum delivery delay | 5,032 ms | 179 ms | 22 ms |
| Peak active connections | 1 | 100 | 100 |

Long polling generated more requests than five-second short polling in this workload because every two-second notification releases all 100 held requests and every client reconnects. Its request volume is therefore event-rate-dependent. SSE required only the initial 100 connections and delivered events with the lowest average delay and lowest average CPU.

## autocannon capacity check

Run:

```bash
npm run autocannon
```

The included check uses 100 connections for 10 seconds against the ordinary short-poll endpoint. It is a capacity test, not the controlled behavioral comparison. The recorded run averaged 9,257.8 requests/second, 10.3 ms latency, and 33 ms p99 latency.

Autocannon is appropriate for request/response HTTP capacity. The custom simulator is used for long polling and SSE because those transports require held or persistent connections and client-side delivery timestamps.

## Regenerate charts

```bash
npm run charts
```

Charts are generated from `results/summary.json` and written to `charts/`.

## Verify the project

```bash
npm run verify
```

The verification script checks required deliverables and confirms that every controlled result used 100 clients and contains real requests, CPU samples, and delivery samples.

## Results and deliverables

- `server/`: common generator, transport endpoints, connection lifecycle, metrics
- `client/`: React UI using fetch and the browser EventSource API
- `benchmark/`: concurrent simulator, autocannon script, statistics, chart generator, validation
- `results/`: raw JSON, summary JSON, system metrics, logs, autocannon output
- `charts/`: measured-data charts
- `screenshots/`: captured live UI and evidence
- `report/`: final DOCX and PDF report

## Reproduction notes

Close unrelated CPU-heavy applications when reproducing the CPU figures. Run the three modes sequentially on the same machine. CPU timings, scheduler behavior, and local loopback performance vary across systems, so exact values will differ while the relative transport behavior should remain similar.

The server binds to `127.0.0.1` for local demonstration. The benchmark admin reset endpoint is intentionally simple and must not be exposed publicly without authentication.
