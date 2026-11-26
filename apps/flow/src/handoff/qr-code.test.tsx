/**
 * C96.5 (Workflow 7A): the handoff QR is drawn locally as an inline SVG image with an accessible
 * name; the same link always draws the same code, at error correction M or higher, with a
 * four-module quiet zone.
 */
import { render, screen } from '@testing-library/react';
import { correction, generate } from 'lean-qr';
import { describe, expect, it } from 'vitest';
import { QrCode } from './qr-code';

const LINK = `https://flow.example.test/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&handoff-token=ovh_${'H'.repeat(43)}`;

describe('QrCode (C96.5)', () => {
  it('draws the link as an SVG image with its name and a quiet zone', () => {
    render(<QrCode value={LINK} label="QR code for your phone" />);

    const image = screen.getByRole('img', { name: 'QR code for your phone' });
    const size = generate(LINK, { minCorrectionLevel: correction.M }).size;
    expect(image.tagName.toLowerCase()).toBe('svg');
    expect(image.getAttribute('viewBox')).toBe(`-4 -4 ${String(size + 8)} ${String(size + 8)}`);
    expect(image.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
  });

  it('draws every dark module of the code, and the same link the same way', () => {
    const first = render(<QrCode value={LINK} label="first" />);
    const second = render(<QrCode value={LINK} label="second" />);
    const pathOf = (container: HTMLElement) => container.querySelector('path')?.getAttribute('d');

    const code = generate(LINK, { minCorrectionLevel: correction.M });
    let dark = 0;
    for (let y = 0; y < code.size; y += 1) {
      for (let x = 0; x < code.size; x += 1) {
        dark += code.get(x, y) ? 1 : 0;
      }
    }
    expect(pathOf(first.container)?.match(/M/g)).toHaveLength(dark);
    expect(pathOf(first.container)).toBe(pathOf(second.container));
  });
});
