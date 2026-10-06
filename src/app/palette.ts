// Single source of colour for both the 3D scene (needs hex) and the CSS
// (tokens in src/ui/tokens.css mirror these). Light "plan sheet" theme.

export const palette = {
  paper: '#f6f4ee',
  ground: '#ebe8df',
  groundLine: '#dedad0',
  block: '#e2ded3',
  asphalt: '#c9c8c2',
  asphaltClosed: '#d8d4ca',
  junction: '#c2c1bb',
  marking: '#fbfaf6',
  markingYellow: '#d6b25a',
  ink: '#22252b',
  inkSoft: '#5d6168',
  accent: '#2f5aa8',
  accentSoft: '#dfe6f3',
  // congestion ramp: free -> slow -> jammed
  flowFree: '#5a9c74',
  flowMid: '#d4a23f',
  flowJam: '#c4513b',
  closed: '#b8463a',
  signalGreen: '#3f9a63',
  signalYellow: '#e0a832',
  signalRed: '#c8453a',
  bus: '#d9a531',
  busLane: '#e9c9c0',
  bike: '#4a8f62',
  bikeLane: '#cfe3cf',
  ped: '#fbfaf6',
  selection: '#2f5aa8',
  hover: '#7f9ccf',
} as const;

/** Vehicle colour by destination zone index (Mini Motorways style). */
export const zoneColors = ['#4f6fae', '#c46a4a', '#5d9470', '#b58a3a', '#8a64a6', '#4f9a9f', '#a65b72', '#6f7a3e'];

/** Utilization / slowness 0..1 → congestion colour. */
export function congestionColor(u: number): string {
  const t = Math.max(0, Math.min(1, u));
  return t < 0.5 ? mix(palette.flowFree, palette.flowMid, t / 0.5) : mix(palette.flowMid, palette.flowJam, (t - 0.5) / 0.5);
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
