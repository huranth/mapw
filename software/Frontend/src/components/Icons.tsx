// Compact stroke-icons (Lucide-family geometry). Each is a plain `<svg>`
// sized via the `size` prop (default 14); stroke is `currentColor` so the
// icon inherits the surrounding text colour and the `--bs-*` palette tints it
// via CSS. No fill, no shadow, 1.5 stroke-width — matched to the hairline
// chrome. All icons are aria-hidden + non-focusable; pair them with readable
// button text so the accessible name carries the affordance.

import type { CSSProperties, ReactNode } from "react";

interface IconProps {
  readonly size?: number;
  readonly style?: CSSProperties;
}

function Svg({
  size = 14,
  style,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Lucide `folder` — a single sheet with a clipped top tab.
export function FolderIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

// Lucide `folder-plus` — folder + a centred "+" mark.
export function FolderPlusIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 11v6M9 14h6" />
    </Svg>
  );
}

// Lucide `rotate-cw` — circular arrow, clockwise.
export function RefreshIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

// Lucide `plus` — two perpendicular stems forming a "+".
export function PlusIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

// Lucide `x` — two diagonals forming a close mark.
export function XIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

// Lucide `arrow-right` — horizontal stem + right-pointing chevron.
export function ArrowRightIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </Svg>
  );
}

// Lucide `terminal` — a small prompt: chevron + underscore.
export function TerminalIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M4 17l6-5-6-5M12 19h8" />
    </Svg>
  );
}

// Lucide `chevron-right` — a single right-pointing angle.
export function ChevronRightIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

// Lucide `copy` — two stacked offset rectangles.
export function CopyIcon({ size, style }: IconProps) {
  return (
    <Svg size={size} style={style}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </Svg>
  );
}
