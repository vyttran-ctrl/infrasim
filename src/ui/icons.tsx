// Line icons, 20px grid, 1.5px stroke, round joins. Drawn for this app.

import type { ReactNode } from 'react';

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
export const IconChevron = ({ up = false }: { up?: boolean }) => (
  <Svg size={14}>
    <path d={up ? 'M5 12.5l5-5 5 5' : 'M5 7.5l5 5 5-5'} />
  </Svg>
);
export const IconCheck = () => (
  <Svg size={14}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </Svg>
);
