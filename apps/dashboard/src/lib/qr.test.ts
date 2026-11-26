// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { qrCode } from './qr';

const URI =
  'otpauth://totp/OpenVerify:operator%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=OpenVerify';

describe('qrCode', () => {
  it('turns the text into the path of a square SVG with a quiet zone', () => {
    const code = qrCode(URI);

    expect(code.size).toBeGreaterThanOrEqual(21 + 8);
    expect((code.size - 8 - 17) % 4).toBe(0);
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    expect(code.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });

  it('draws modules inside the quiet zone only', () => {
    const code = qrCode(URI);
    const cells = [...code.path.matchAll(/M(\d+) (\d+)/g)].map((match): [number, number] => [
      Number(match[1]),
      Number(match[2]),
    ]);

    expect(
      cells.every(([x, y]) => x >= 4 && y >= 4 && x < code.size - 4 && y < code.size - 4),
    ).toBe(true);
    // The finder pattern's corner module is always dark.
    expect(code.path.startsWith('M4 4h1v1h-1z')).toBe(true);
  });

  it('is the same for the same text', () => {
    expect(qrCode(URI)).toEqual(qrCode(URI));
  });
});
