import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const METHODS = {
  poll: { label: 'Short Polling', detail: 'GET every 5 seconds', accent: '#2563eb' },
  long: { label: 'Long Polling', detail: 'Request held until an update', accent: '#7c3aed' },
  sse: { label: 'Server-Sent Events', detail: 'One persistent EventSource stream', accent: '#059669' }
};

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour12: false, fractionalSecondDigits: 3 });
}

function LiveFeed({ method }) {
  const clientId = useMemo(() => `${method}-${crypto.randomUUID().slice(0, 8)}`, [method]);
  const [status, setStatus] = useState('connecting');
  const [items, setItems] = useState([]);
  const [receivedCount, setReceivedCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [lastDelay, setLastDelay] = useState(null);
  const lastId = useRef(0);

  const accept = useCallback((notification) => {
    const receivedAt = Date.now();
    const deliveryDelayMs = receivedAt - notification.generatedAt;
    lastId.current = Math.max(lastId.current, notification.id);
    setLastDelay(deliveryDelayMs);
    setReceivedCount((value) => value + 1);
    setItems((current) => [{ ...notification, receivedAt, deliveryDelayMs }, ...current].slice(0, 12));
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer;
    let controller;
    let eventSource;

    async function runPoll() {
      if (stopped) return;
      setStatus('connected');
      const started = Date.now();
      try {
        setRequestCount((value) => value + 1);
        const response = await fetch(`/api/poll?since=${lastId.current}&clientId=${clientId}`);
        const body = await response.json();
        body.notifications.forEach(accept);
      } catch {
        if (!stopped) setStatus('reconnecting');
      }
      const remaining = Math.max(0, 5000 - (Date.now() - started));
      timer = setTimeout(runPoll, remaining);
    }

    async function runLongPoll() {
      while (!stopped) {
        controller = new AbortController();
        try {
          setStatus('waiting');
          setRequestCount((value) => value + 1);
          const response = await fetch(`/api/long-poll?since=${lastId.current}&clientId=${clientId}`, { signal: controller.signal });
          const body = await response.json();
          body.notifications.forEach(accept);
          setStatus('connected');
        } catch {
          if (!stopped) setStatus('reconnecting');
        }
      }
    }

    if (method === 'poll') runPoll();
    if (method === 'long') runLongPoll();
    if (method === 'sse') {
      eventSource = new EventSource(`/api/events?since=${lastId.current}&clientId=${clientId}`);
      setRequestCount(1);
      eventSource.addEventListener('ready', () => setStatus('connected'));
      eventSource.addEventListener('notification', (event) => accept(JSON.parse(event.data)));
      eventSource.onerror = () => setStatus('reconnecting');
    }

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      eventSource?.close();
    };
  }, [method, clientId, accept]);

  const meta = METHODS[method];
  return (
    <section className="feed-panel" style={{ '--accent': meta.accent }}>
      <div className="status-strip">
        <div>
          <span className={`status-dot ${status}`} />
          <strong>{status}</strong>
        </div>
        <span>{meta.detail}</span>
      </div>
      <div className="metric-grid">
        <article><span>Client ID</span><strong>{clientId}</strong></article>
        <article><span>Received</span><strong>{receivedCount}</strong></article>
        <article><span>HTTP requests</span><strong>{requestCount}</strong></article>
        <article><span>Latest delay</span><strong>{lastDelay === null ? 'Waiting' : `${lastDelay} ms`}</strong></article>
      </div>
      <div className="feed-heading">
        <h2>Live notification feed</h2>
        <span>Generated on the server</span>
      </div>
      <div className="feed-list">
        {items.length === 0 && <div className="empty">Waiting for the first shared notification...</div>}
        {items.map((item) => (
          <article className="notification" key={item.id}>
            <div className="notification-id">#{item.id}</div>
            <div><strong>{item.message}</strong><span>Generated {formatTime(item.generatedAt)}</span></div>
            <div className="delay">{item.deliveryDelayMs} ms</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Results() {
  const [summary, setSummary] = useState(null);
  useEffect(() => { fetch('/api/results').then((r) => r.json()).then(setSummary).catch(() => setSummary({ error: true })); }, []);
  if (!summary || summary.error) return <section className="feed-panel"><div className="empty">Run the benchmark to populate measured results.</div></section>;
  const rows = ['shortPolling', 'longPolling', 'sse'];
  return (
    <section className="results-panel" data-testid="results-panel">
      <div className="results-title"><div><span>CONTROLLED BENCHMARK</span><h2>100 concurrent clients</h2></div><strong>{summary.configuration.durationSeconds}s per transport</strong></div>
      <div className="results-table-wrap" data-testid="comparison-table"><table><thead><tr><th>Transport</th><th>Requests/min</th><th>Avg CPU</th><th>Avg delay</th><th>Median delay</th><th>Peak connections</th></tr></thead><tbody>
        {rows.map((key) => { const row = summary.transports[key]; return <tr key={key}><td>{row.label}</td><td>{row.requestsPerMinute.toFixed(1)}</td><td>{row.averageCpuPercent.toFixed(2)}%</td><td>{row.deliveryDelayMs.average.toFixed(1)} ms</td><td>{row.deliveryDelayMs.median.toFixed(1)} ms</td><td>{row.peakActiveConnections}</td></tr>; })}
      </tbody></table></div>
      <div className="chart-grid" data-testid="chart-grid">
        <img src="/charts/requests-per-minute.png" alt="Requests per minute chart" />
        <img src="/charts/cpu-usage.png" alt="Server CPU chart" />
        <img src="/charts/delivery-delay.png" alt="Delivery delay chart" />
      </div>
    </section>
  );
}

function Evidence() {
  const [tree, setTree] = useState('Loading project structure...');
  const [autocannon, setAutocannon] = useState('Loading autocannon output...');
  useEffect(() => {
    fetch('/api/project-structure').then((r) => r.text()).then(setTree);
    fetch('/api/autocannon').then((r) => r.text()).then(setAutocannon);
  }, []);
  return (
    <section className="evidence-panel">
      <div className="evidence-card" data-testid="project-structure"><span>IMPLEMENTED DELIVERABLES</span><h2>Project structure</h2><pre>{tree}</pre></div>
      <div className="evidence-card dark" data-testid="autocannon-output"><span>REAL HTTP CAPACITY CHECK</span><h2>autocannon output</h2><pre>{autocannon}</pre></div>
    </section>
  );
}

function App() {
  const [tab, setTab] = useState('poll');
  return (
    <main>
      <header>
        <div className="eyebrow">FSD INTERNAL 2 · ASSIGNMENT 19</div>
        <h1>Real-Time Transport Lab</h1>
        <p>One notification source. Three delivery strategies. Measured with 100 concurrent clients.</p>
      </header>
      <nav>
        {Object.entries(METHODS).map(([key, value]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{value.label}<span>{value.detail}</span></button>)}
        <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>Benchmark Results<span>Measured evidence</span></button>
        <button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>Project Evidence<span>Files and autocannon</span></button>
      </nav>
      {tab === 'results' ? <Results /> : tab === 'evidence' ? <Evidence /> : <LiveFeed key={tab} method={tab} />}
      <footer>Short polling · Long polling · Server-Sent Events</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
