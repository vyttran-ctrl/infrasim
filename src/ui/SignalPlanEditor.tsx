import { useApp } from '../app/store';
import { setSignalTiming } from '../net';
import type { SignalPlan } from '../sim/types';
import { SectionHead, Stepper } from './controls';
import { num } from './format';
import { commitEdit, tryEdit } from './uiStore';

type TimingKey = 'green' | 'yellow' | 'allRed';
const LIMITS: Record<TimingKey, { min: number; max: number; step: number; label: string }> = {
  green: { min: 5, max: 120, step: 5, label: 'Green' },
  yellow: { min: 2, max: 6, step: 0.5, label: 'Yellow' },
  allRed: { min: 0, max: 5, step: 0.5, label: 'All-red' },
};

export function cycleLength(plan: SignalPlan) {
  return plan.phases.reduce((t, p) => t + p.green + p.yellow + p.allRed, 0) + plan.pedPhase;
}

export function SignalPlanEditor({ plan, label }: { plan: SignalPlan; label: string }) {
  const cycle = cycleLength(plan);
  const summary = plan.phases.map((p) => `${p.name} green ${num(p.green)} s`).join(', ');

  const setTiming = (i: number, key: TimingKey, v: number) =>
    tryEdit(() => {
      const net = useApp.getState().network;
      const ph = plan.phases[i];
      commitEdit(setSignalTiming(net, plan.nodeId, i, { [key]: v }), `${label}: ${ph.name} ${LIMITS[key].label.toLowerCase()} ${num(v, v % 1 ? 1 : 0)} s`);
    });

  return (
    <>
      <SectionHead aside={<span className="mono">cycle {num(cycle)} s</span>}>Signal plan</SectionHead>
      <CycleBar plan={plan} cycle={cycle} />
      <p className="plan-summary">{summary}.</p>
      <table className="plan-table">
        <thead>
          <tr>
            {(Object.keys(LIMITS) as TimingKey[]).map((k) => (
              <th key={k} scope="col" className="caps">
                {LIMITS[k].label} s
              </th>
            ))}
          </tr>
        </thead>
        {plan.phases.map((p, i) => (
          <tbody key={i}>
            <tr>
              <th scope="rowgroup" colSpan={3} className="plan-phase">
                {i + 1}. {p.name}
              </th>
            </tr>
            <tr>
              {(Object.keys(LIMITS) as TimingKey[]).map((k) => (
                <td key={k}>
                  <Stepper
                    label={`${p.name} ${LIMITS[k].label}`}
                    value={p[k]}
                    min={LIMITS[k].min}
                    max={LIMITS[k].max}
                    step={LIMITS[k].step}
                    digits={k === 'green' ? 0 : 1}
                    onChange={(v) => setTiming(i, k, v)}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        ))}
      </table>
    </>
  );
}

/** Proportional strip of one cycle: green / yellow / all-red per phase, then the ped phase. */
function CycleBar({ plan, cycle }: { plan: SignalPlan; cycle: number }) {
  if (cycle <= 0) return null;
  const segs: { w: number; cls: string; title: string; text?: string }[] = [];
  plan.phases.forEach((p) => {
    segs.push({ w: p.green, cls: 'cy-green', title: `${p.name} green ${p.green} s`, text: p.name });
    segs.push({ w: p.yellow, cls: 'cy-yellow', title: `${p.name} yellow ${p.yellow} s` });
    if (p.allRed > 0) segs.push({ w: p.allRed, cls: 'cy-red', title: `All-red ${p.allRed} s` });
  });
  if (plan.pedPhase > 0) segs.push({ w: plan.pedPhase, cls: 'cy-ped', title: `Pedestrian phase ${plan.pedPhase} s`, text: 'Walk' });
  return (
    <div className="cycle-bar" role="img" aria-label={segs.map((s) => s.title).join(', ')}>
      {segs.map((s, i) => (
        <span key={i} className={`cy ${s.cls}`} style={{ flexGrow: s.w }} title={s.title}>
          {s.text && s.w / cycle > 0.14 ? s.text : ''}
        </span>
      ))}
    </div>
  );
}
