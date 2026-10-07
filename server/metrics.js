class Metrics {
  constructor() {
    this.cpuTimer = null;
    this.reset('idle');
  }

  reset(mode) {
    if (this.cpuTimer) clearInterval(this.cpuTimer);
    this.mode = mode;
    this.startedAt = Date.now();
    this.startedCpu = process.cpuUsage();
    this.lastCpu = this.startedCpu;
    this.lastCpuAt = process.hrtime.bigint();
    this.requestCounts = { poll: 0, longPoll: 0, sse: 0, other: 0 };
    this.notificationsGenerated = 0;
    this.notificationsDispatched = { poll: 0, longPoll: 0, sse: 0 };
    this.activeConnections = { poll: 0, longPoll: 0, sse: 0 };
    this.peakConnections = { poll: 0, longPoll: 0, sse: 0 };
    this.connectionSamples = [];
    this.connectionDurationsMs = { longPoll: [], sse: [] };
    this.cpuSamples = [];
    this.cpuTimer = setInterval(() => this.sample(), 1000);
  }

  sample() {
    const now = Date.now();
    const hrNow = process.hrtime.bigint();
    const cpuNow = process.cpuUsage();
    const elapsedMicros = Number(hrNow - this.lastCpuAt) / 1000;
    const usedMicros = (cpuNow.user - this.lastCpu.user) + (cpuNow.system - this.lastCpu.system);
    const percentOneCore = elapsedMicros > 0 ? (usedMicros / elapsedMicros) * 100 : 0;
    this.cpuSamples.push({ at: now, percentOneCore });
    this.connectionSamples.push({ at: now, ...this.activeConnections });
    this.lastCpuAt = hrNow;
    this.lastCpu = cpuNow;
  }

  request(type) {
    this.requestCounts[type] = (this.requestCounts[type] || 0) + 1;
  }

  connectionOpen(type) {
    this.activeConnections[type] += 1;
    this.peakConnections[type] = Math.max(this.peakConnections[type], this.activeConnections[type]);
  }

  connectionClose(type, durationMs) {
    this.activeConnections[type] = Math.max(0, this.activeConnections[type] - 1);
    if (this.connectionDurationsMs[type] && Number.isFinite(durationMs)) {
      this.connectionDurationsMs[type].push(durationMs);
    }
  }

  dispatch(type, count = 1) {
    this.notificationsDispatched[type] += count;
  }

  snapshot() {
    const durationMs = Date.now() - this.startedAt;
    const totalCpu = process.cpuUsage(this.startedCpu);
    return {
      mode: this.mode,
      startedAt: this.startedAt,
      capturedAt: Date.now(),
      durationMs,
      requestCounts: this.requestCounts,
      notificationsGenerated: this.notificationsGenerated,
      notificationsDispatched: this.notificationsDispatched,
      activeConnections: this.activeConnections,
      peakConnections: this.peakConnections,
      connectionSamples: this.connectionSamples,
      connectionDurationsMs: this.connectionDurationsMs,
      cpuSamples: this.cpuSamples,
      processCpuMicros: totalCpu
    };
  }
}

module.exports = { Metrics };
