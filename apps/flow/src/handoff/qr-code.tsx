/**
 * C96.5 (Workflow 7A): the handoff QR, drawn locally as an inline SVG by `lean-qr` 2.7.4 (MIT), the
 * smallest of the three measured candidates (docs/flow/handoff.md): no third-party service, no
 * network, no `data:` URL. Error correction at least M; a four-module quiet zone. Its text
 * alternative is the link shown beside it; the image itself carries an accessible name.
 */
import { correction, generate } from 'lean-qr';
import { useMemo } from 'react';
import { iconDirectionClass } from '../i18n/icon-direction';

export interface QrCodeProps {
  /** The whole link the phone opens. */
  readonly value: string;
  /** The image's accessible name. */
  readonly label: string;
}

/** The quiet zone around the code, in modules (ISO/IEC 18004 asks for four). */
const QUIET_ZONE = 4;

/** One path of unit squares, one per dark module. */
function pathOf(value: string): { size: number; d: string } {
  const code = generate(value, { minCorrectionLevel: correction.M });
  let d = '';
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (code.get(x, y)) {
        d += `M${String(x)} ${String(y)}h1v1h-1z`;
      }
    }
  }
  return { size: code.size, d };
}

export function QrCode({ value, label }: QrCodeProps) {
  const { size, d } = useMemo(() => pathOf(value), [value]);
  const box = size + QUIET_ZONE * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      // C161.3 (Workflow 9A): a QR code is never mirrored, whatever the direction of the page.
      data-icon="qr-code"
      viewBox={`${String(-QUIET_ZONE)} ${String(-QUIET_ZONE)} ${String(box)} ${String(box)}`}
      className={`${iconDirectionClass('qr-code')} h-56 w-56 max-w-full bg-white`.trim()}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={box} height={box} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
