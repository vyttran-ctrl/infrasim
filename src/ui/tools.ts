import type { Tool } from '../app/store';

export interface ToolMeta {
  id: Tool;
  label: string;
  key: string;
  hint: string;
}

export const TOOLS: ToolMeta[] = [
  { id: 'inspect', label: 'Inspect', key: 'V', hint: 'Click a road or junction to inspect and edit it' },
  { id: 'close', label: 'Close', key: 'C', hint: 'Click a road to close or reopen it (both directions)' },
  { id: 'lanes', label: 'Lanes', key: 'L', hint: 'Click a road, then set its lane count in the inspector' },
  { id: 'speed', label: 'Speed', key: 'S', hint: 'Click a road, then set its speed limit in the inspector' },
  { id: 'signal', label: 'Signal', key: 'G', hint: 'Click a junction to edit its signal plan' },
  { id: 'newRoad', label: 'New road', key: 'N', hint: 'Click a start junction, then an end junction. Esc cancels' },
  { id: 'oneWay', label: 'One-way', key: 'O', hint: 'Click a road to switch it between one-way and two-way' },
  { id: 'roundabout', label: 'Roundabout', key: 'U', hint: 'Click a junction to turn it into a roundabout, or back to a signal' },
  { id: 'busLane', label: 'Bus lane', key: 'B', hint: 'Click a road with 2 or more lanes to add or remove a bus lane' },
  { id: 'bikeLane', label: 'Bike lane', key: 'K', hint: 'Click a road to add or remove a protected bike lane' },
  { id: 'ped', label: 'Crossing', key: 'P', hint: 'Click a junction to add or remove a pedestrian crossing' },
];

export const TOOL_BY_KEY: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
export const TOOL_META: Record<Tool, ToolMeta> = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<Tool, ToolMeta>;

export const SPEEDS = [0.5, 1, 2, 5, 10] as const;
