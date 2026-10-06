// Small shared controls: stepper, segmented control, switch, readout rows.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { clamp, num } from './format';

export function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  digits = 0,
  onChange,
  disabled,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: 0 | 1;
  onChange(v: number): void;
  disabled?: boolean;
  label: string;
}) {
  const set = (v: number) => {
    const next = clamp(Math.round(v / step) * step, min, max);
    if (next !== value) onChange(Number(next.toFixed(2)));
  };
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="stepper-btn" onClick={() => set(value - step)} disabled={disabled || value <= min} aria-label={`Decrease ${label}`}>
        −
      </button>
      <output className="stepper-val mono" aria-live="polite">
        {num(value, digits)}
        {unit && <span className="unit">{unit}</span>}
      </output>
      <button type="button" className="stepper-btn" onClick={() => set(value + step)} disabled={disabled || value >= max} aria-label={`Increase ${label}`}>
        +
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  disabled,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange(v: T): void;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="seg-btn"
          title={o.title}
          disabled={disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** Label left (small caps), value right (mono). */
export function Row({ label, children, tone, title }: { label: ReactNode; children: ReactNode; tone?: 'bad'; title?: string }) {
  return (
    <div className={`row${tone ? ` row-${tone}` : ''}`} title={title}>
      <dt className="row-label">{label}</dt>
      <dd className="row-val mono">{children}</dd>
    </div>
  );
}

export function Val({ v, unit }: { v: ReactNode; unit?: string }) {
  return (
    <>
      {v}
      {unit && <span className="unit">{unit}</span>}
    </>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: (id: string) => ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-control">{children(id)}</div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function SectionHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="caps">{children}</h2>
      {aside}
    </div>
  );
}

/** Re-render every `ms` while mounted (for reading sim.latest). */
export function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** A numeric text input that commits on Enter or blur. */
export function NumberInput({
  id,
  value,
  min,
  max,
  step = 1,
  onCommit,
  disabled,
  width = 7,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit(v: number): void;
  disabled?: boolean;
  width?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (!Number.isFinite(v) || draft.trim() === '') return setDraft(String(value));
    const c = clamp(v, min, max);
    setDraft(String(c));
    if (c !== value) onCommit(c);
  };
  return (
    <input
      id={id}
      className="input mono"
      style={{ width: `${width}ch` }}
      inputMode="decimal"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
