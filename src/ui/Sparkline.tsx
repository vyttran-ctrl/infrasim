// Ink sparkline, no axes. Last value marked with a dot.

export function Sparkline({ values, width = 116, height = 24, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) {
    return <svg className="spark" width={width} height={height} role="img" aria-label={`${label}: no data yet`} />;
  }
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values[values.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="spark-base" />
      <path d={d} className="spark-line" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2} className="spark-dot" />
    </svg>
  );
}
