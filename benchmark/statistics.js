function numericSummary(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return { count: 0, average: 0, median: 0, min: 0, max: 0, p95: 0 };
  const average = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const middle = Math.floor(clean.length / 2);
  const median = clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  const p95 = clean[Math.min(clean.length - 1, Math.ceil(clean.length * 0.95) - 1)];
  return { count: clean.length, average, median, min: clean[0], max: clean[clean.length - 1], p95 };
}

module.exports = { numericSummary };
