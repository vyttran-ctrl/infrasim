// Line icons, 20px grid, 1.5px stroke, round joins. Drawn for this app.

import type { ReactNode } from 'react';
import type { Tool } from '../app/store';

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const toolIcons: Record<Tool, ReactNode> = {
  inspect: (
    <Svg>
      <path d="M5 3.5l10 5.2-4.3 1.3-1.9 4.5z" />
      <path d="M10.7 10l3.6 4.7" />
    </Svg>
  ),
  close: (
    <Svg>
      <rect x="2.5" y="7" width="15" height="5" rx="0.5" />
      <path d="M6 7l-2.5 5M10.5 7L8 12M15 7l-2.5 5" />
      <path d="M5 12v4M15 12v4" />
    </Svg>
  ),
  lanes: (
    <Svg>
      <path d="M4 3v14M16 3v14" />
      <path d="M10 3v2.5M10 8.75v2.5M10 14.5V17" />
    </Svg>
  ),
  speed: (
    <Svg>
      <path d="M3.5 14a6.5 6.5 0 1 1 13 0" />
      <path d="M10 14l3.2-4.2" />
      <path d="M3.5 14h1.5M15 14h1.5M10 7.5V9" />
    </Svg>
  ),
  signal: (
    <Svg>
      <rect x="6.5" y="2.5" width="7" height="12" rx="1.5" />
      <circle cx="10" cy="5.6" r="1.1" />
      <circle cx="10" cy="8.5" r="1.1" />
      <circle cx="10" cy="11.4" r="1.1" />
      <path d="M10 14.5v3" />
    </Svg>
  ),
  newRoad: (
    <Svg>
      <circle cx="4.5" cy="15.5" r="1.8" />
      <circle cx="13" cy="7" r="1.8" />
      <path d="M5.8 14.2l5.9-5.9" strokeDasharray="2 2" />
      <path d="M16 2.5v4M14 4.5h4" />
    </Svg>
  ),
  oneWay: (
    <Svg>
      <path d="M3 10h13" />
      <path d="M12 6l4 4-4 4" />
    </Svg>
  ),
  roundabout: (
    <Svg>
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2.5v4.5M10 13v4.5M2.5 10H7M13 10h4.5" />
      <path d="M14.6 6.2a6 6 0 0 0-2.8-2.5" />
    </Svg>
  ),
  busLane: (
    <Svg>
      <rect x="4" y="3" width="12" height="11.5" rx="1.5" />
      <path d="M4 9.5h12M4 6h12" />
      <path d="M6.5 14.5v2M13.5 14.5v2" />
      <circle cx="7" cy="12" r="0.6" />
      <circle cx="13" cy="12" r="0.6" />
    </Svg>
  ),
  bikeLane: (
    <Svg>
      <circle cx="5" cy="13.5" r="3" />
      <circle cx="15" cy="13.5" r="3" />
      <path d="M5 13.5l3-6h5l2 6M8 7.5l2.6 6H15M7 5.5h2.5" />
    </Svg>
  ),
  ped: (
    <Svg>
      <path d="M3 4h14M3 16h14" />
      <path d="M5.5 7v6M8.5 7v6M11.5 7v6M14.5 7v6" />
    </Svg>
  ),
};

export const IconPlay = () => (
  <Svg size={16}>
    <path d="M6 4.5l9 5.5-9 5.5z" />
  </Svg>
);
export const IconPause = () => (
  <Svg size={16}>
    <path d="M7 4.5v11M13 4.5v11" />
  </Svg>
);
export const IconReset = () => (
  <Svg size={16}>
    <path d="M4 10a6 6 0 1 0 1.8-4.3" />
    <path d="M4 3.5v3.5h3.5" />
  </Svg>
);
export const IconDice = () => (
  <Svg size={16}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
    <circle cx="7.3" cy="7.3" r="0.8" />
    <circle cx="12.7" cy="12.7" r="0.8" />
    <circle cx="10" cy="10" r="0.8" />
  </Svg>
);
export const IconSliders = () => (
  <Svg size={16}>
    <path d="M3 6h8M15 6h2M3 14h2M9 14h8" />
    <circle cx="13" cy="6" r="2" />
    <circle cx="7" cy="14" r="2" />
  </Svg>
);
export const IconClose = () => (
  <Svg size={16}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Svg>
);
export const IconUndo = () => (
  <Svg size={16}>
    <path d="M7 5L3.5 8.5 7 12" />
    <path d="M3.5 8.5H12a4.5 4.5 0 0 1 0 9H9" />
  </Svg>
);
export const IconCompare = () => (
  <Svg size={16}>
    <path d="M4 16V8M10 16V4M16 16v-6" />
  </Svg>
);
export const IconTarget = () => (
  <Svg size={16}>
    <circle cx="10" cy="10" r="5.5" />
    <path d="M10 2v3M10 15v3M2 10h3M15 10h3" />
  </Svg>
);
export const IconChevron = ({ up = false }: { up?: boolean }) => (
  <Svg size={14}>
    <path d={up ? 'M5 12.5l5-5 5 5' : 'M5 7.5l5 5 5-5'} />
  </Svg>
);
