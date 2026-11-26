/**
 * QR codes drawn on the server (C22): `qrcode` (MIT) computes the modules, and the page renders
 * them as one SVG path, so no markup string is injected and no image is fetched.
 */
import 'server-only';
import QRCode from 'qrcode';

/** Modules of white border on each side, as the QR specification asks. */
const QUIET_ZONE = 4;

export interface QrCodeGeometry {
  /** Width and height in modules, quiet zone included: the SVG's viewBox. */
  readonly size: number;
  /** One 1x1 square per dark module. */
  readonly path: string;
}

export function qrCode(text: string): QrCodeGeometry {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  let path = '';
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) {
        path += `M${String(column + QUIET_ZONE)} ${String(row + QUIET_ZONE)}h1v1h-1z`;
      }
    }
  }
  return { size: modules.size + 2 * QUIET_ZONE, path };
}
