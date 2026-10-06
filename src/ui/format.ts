// Unit formatting. Every displayed number goes through one of these so units
// and precision stay consistent across the dashboard, inspector and compare.

export const DASH = '–';

const nf0 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Thousands separators, fixed decimals. */
export function num(v: number | null | undefined, digits: 0 | 1 | 2 = 0): string {
  if (!ok(v)) return DASH;
  return (digits === 0 ? nf0 : digits === 1 ? nf1 : nf2).format(v);
}

export const MPS_TO_KMH = 3.6;
export function kmh(mps: number | null | undefined, digits: 0 | 1 = 1): string {
  return ok(mps) ? num(mps * MPS_TO_KMH, digits) : DASH;
}
export function toKmh(mps: number): number {
  return mps * MPS_TO_KMH;
}
export function toMps(kmhValue: number): number {
  return kmhValue / MPS_TO_KMH;
}

/** Seconds to minutes. */
export function minutes(s: number | null | undefined, digits: 0 | 1 | 2 = 1): string {
  return ok(s) ? num(s / 60, digits) : DASH;
}

/** 0..1 to "42". Caller appends the % unit. */
export function pct(frac: number | null | undefined, digits: 0 | 1 = 0): string {
  return ok(frac) ? num(frac * 100, digits) : DASH;
}

/** Signed percentage change, e.g. "+12.4" / "-3.0". */
export function signedPct(v: number): string {
  if (!Number.isFinite(v)) return DASH;
  const s = nf1.format(Math.abs(v));
  return (v > 0 ? '+' : v < 0 ? '-' : '') + s;
}

/** Seconds to mm:ss (or h:mm:ss past an hour). */
export function clock(s: number | null | undefined): string {
  if (!ok(s)) return '00:00';
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
