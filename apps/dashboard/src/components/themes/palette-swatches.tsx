import type { ContrastPalette } from '@openverify/core';
import { THEMES_COPY } from '../../lib/copy/themes-copy';

const copy = THEMES_COPY.editor;

/**
 * A sketch of one palette (C160): a card on the canvas with text, muted text, an error, a control,
 * a separator and a focused button. Colours are SVG presentation attributes, never inline styles,
 * so the console's CSP holds (C170). It is not a flow screen: the template preview shows those.
 */
export function PaletteSwatches({
  palette,
  label,
  radius,
}: {
  readonly palette: ContrastPalette;
  readonly label: string;
  readonly radius: number;
}) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 320 168"
      className="h-auto w-full max-w-sm rounded-md border border-line"
    >
      <rect x="0" y="0" width="320" height="168" fill={palette.canvas} />
      <rect x="12" y="12" width="296" height="144" rx={radius} fill={palette.surface} />
      <text x="28" y="40" fontSize="14" fill={palette.ink}>
        {copy.previewSample}
      </text>
      <text x="28" y="60" fontSize="12" fill={palette['ink-muted']}>
        {copy.previewMuted}
      </text>
      <line x1="28" y1="72" x2="292" y2="72" stroke={palette.line} strokeWidth="1" />
      <rect
        x="28"
        y="82"
        width="120"
        height="24"
        rx={radius}
        fill="none"
        stroke={palette.control}
      />
      <text x="28" y="124" fontSize="12" fill={palette.danger}>
        {copy.previewError}
      </text>
      <rect
        x="166"
        y="80"
        width="126"
        height="32"
        rx={radius + 2}
        fill="none"
        stroke={palette.focus}
        strokeWidth="2"
      />
      <rect x="170" y="84" width="118" height="24" rx={radius} fill={palette.primary} />
      <text x="229" y="100" fontSize="12" textAnchor="middle" fill={palette['on-primary']}>
        {copy.previewButton}
      </text>
      <rect x="170" y="120" width="118" height="24" rx={radius} fill={palette.danger} />
    </svg>
  );
}
