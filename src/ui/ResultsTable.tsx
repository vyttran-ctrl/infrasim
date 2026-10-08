import type { Scenario } from '../sim/types';
import { COMPARE_METRICS, deltaPct, verdict } from './compareMetrics';
import { num, signedPct } from './format';

/** Metric rows × scenario columns. First column is the baseline. */
export function ResultsTable({ scenarios, subLabels = true }: { scenarios: Scenario[]; subLabels?: boolean }) {
  const base = scenarios[0]?.result;
  if (!base) return null;
  return (
    <div className="table-scroll">
      <table className="results">
        <thead>
          <tr>
            <th scope="col" className="caps">
              Metric
            </th>
            {scenarios.map((s, i) => (
              <th key={s.id} scope="col">
                <span className="results-name">{s.name}</span>
                {subLabels && <span className="caps muted">{i === 0 ? 'Baseline' : 'vs baseline'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_METRICS.map((m) => {
            const b = m.get(base);
            return (
              <tr key={m.key}>
                <th scope="row">
                  {m.label} <span className="unit">{m.unit}</span>
                  <span className="results-dir muted">
                    {m.lowerBetter ? 'lower is better' : 'higher is better'}
                  </span>
                </th>
                {scenarios.map((s, i) => {
                  if (!s.result) return <td key={s.id} className="mono muted">–</td>;
                  const v = m.get(s.result);
                  if (i === 0) return <td key={s.id} className="mono">{num(v, m.digits)}</td>;
                  const d = deltaPct(v, b);
                  const tone = verdict(d, m.lowerBetter);
                  return (
                    <td key={s.id} className="mono">
                      {num(v, m.digits)}
                      <span className={`delta delta-${tone}`}>
                        {tone === 'same' ? '=' : d < 0 ? '↓' : '↑'} {Number.isFinite(d) ? `${signedPct(d)} %` : 'n/a'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
