// Inline SVG charts for the comparison: horizontal bars per key metric and
// an overlaid average-speed line per scenario.

import { zoneColors } from '../app/palette';
import type { Scenario } from '../sim/types';
import { COMPARE_METRICS, deltaPct, verdict } from './compareMetrics';
import { num, toKmh } from './format';

export const seriesColor = (i: number) => zoneColors[i % zoneColors.length];

export function MetricBars({ scenarios }: { scenarios: Scenario[] }) {
  const withResult = scenarios.filter((s) => s.result);
  if (withResult.length === 0) return null;
  const base = withResult[0].result!;
  return (
    <div className="bars">
      {COMPARE_METRICS.filter((m) => m.chart).map((m) => {
        const vals = withResult.map((s) => m.get(s.result!));
        const max = Math.max(...vals, 0) || 1;
        return (
          <figure key={m.key} className="bar-fig">
            <figcaption className="caps">
              {m.label} <span className="unit">{m.unit}</span>
            </figcaption>
            {withResult.map((s, i) => {
              const v = vals[i];
              const tone = i === 0 ? 'base' : verdict(deltaPct(v, m.get(base)), m.lowerBetter);
              return (
                <div key={s.id} className="bar-row" title={`${s.name}: ${num(v, m.digits)} ${m.unit}`}>
                  <span className="bar-name">{s.name}</span>
                  <span className="bar-track">
                    <span className={`bar bar-${tone}`} style={{ width: `${(v / max) * 100}%` }} />
                  </span>
                  <span className="mono bar-val">{num(v, m.digits)}</span>
                </div>
              );
            })}
          </figure>
        );
      })}
    </div>
  );
}

export function SpeedOverTime({ scenarios }: { scenarios: Scenario[] }) {
  const lines = scenarios
    .map((s, i) => ({ s, i, pts: s.result?.series ?? [] }))
    .filter((l) => l.pts.length > 1);
  if (lines.length === 0) return null;
  const W = 520;
  const H = 160;
  const L = 36;
  const B = 22;
  const T = 8;
  const R = 8;
  const tMax = Math.max(...lines.map((l) => l.pts[l.pts.length - 1].t)) || 1;
  const vMax = Math.ceil(Math.max(...lines.flatMap((l) => l.pts.map((p) => toKmh(p.avgSpeed))), 10) / 10) * 10;
  const x = (t: number) => L + (t / tMax) * (W - L - R);
  const y = (v: number) => H - B - (v / vMax) * (H - B - T);
  const yTicks = [0, vMax / 2, vMax];
  const minutesMax = tMax / 60;
  const xStep = minutesMax > 30 ? 10 : 5;
  const xTicks: number[] = [];
  for (let mm = 0; mm <= minutesMax + 0.01; mm += xStep) xTicks.push(mm);

  return (
    <figure className="line-fig">
      <figcaption className="caps">
        Average speed over time <span className="unit">km/h</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" role="img" aria-label="Average network speed over simulated time for each scenario">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 6} y={y(v) + 3.5} className="tick" textAnchor="end">
              {num(v)}
            </text>
          </g>
        ))}
        {xTicks.map((mm) => (
          <text key={mm} x={x(mm * 60)} y={H - 6} className="tick" textAnchor="middle">
            {mm} min
          </text>
        ))}
        {lines.map(({ s, i, pts }) => (
          <path
            key={s.id}
            d={pts.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(toKmh(p.avgSpeed)).toFixed(1)}`).join('')}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={i === 0 ? 2 : 1.5}
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <ul className="legend-list">
        {lines.map(({ s, i }) => (
          <li key={s.id}>
            <span className="swatch" style={{ background: seriesColor(i) }} aria-hidden="true" />
            {s.name}
            {i === 0 && <span className="muted"> (baseline)</span>}
          </li>
        ))}
      </ul>
    </figure>
  );
}
