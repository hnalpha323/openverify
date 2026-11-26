/**
 * C161.3 (the engineering note's 5.4): directional icons (back, next, chevrons) mirror in a
 * right-to-left language with `rtl:-scale-x-100`; icons of physical things never do: the selfie
 * pose prompts ("turn left" means the person's own left in every language, so the arrow points
 * the same way on screen in Arabic as in English), the camera, check marks, document outlines,
 * logos and the QR code. At the Phase 9 base the flow draws no directional icon (Stage 1a
 * amendment 12), so this is the rule every icon `flow-renderer` adds follows.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  FLOW_ICONS,
  MIRRORED_ICON_CLASS,
  iconDirectionClass,
  isMirroredIcon,
  type FlowIcon,
} from './icon-direction';

const MIRRORED: readonly FlowIcon[] = ['back', 'next', 'chevron-start', 'chevron-end'];

describe('the direction rule for icons (C161.3)', () => {
  it('mirrors with Tailwind’s rtl variant, never with a stylesheet of its own', () => {
    expect(MIRRORED_ICON_CLASS).toBe('rtl:-scale-x-100');
  });

  it.each(MIRRORED)('mirrors the directional icon %s', (icon) => {
    expect(isMirroredIcon(icon)).toBe(true);
    expect(iconDirectionClass(icon)).toBe('rtl:-scale-x-100');
  });

  it('never mirrors the selfie pose prompts: “left” is the person’s own left', () => {
    for (const icon of ['pose-left', 'pose-right', 'pose-center'] as const) {
      expect(isMirroredIcon(icon)).toBe(false);
      expect(iconDirectionClass(icon)).toBe('');
    }
  });

  it('never mirrors the camera', () => {
    expect(iconDirectionClass('camera')).toBe('');
  });

  it('never mirrors a check mark', () => {
    expect(iconDirectionClass('check')).toBe('');
  });

  it('never mirrors a document outline', () => {
    expect(iconDirectionClass('document-outline')).toBe('');
  });

  it('never mirrors a logo', () => {
    expect(iconDirectionClass('logo')).toBe('');
  });

  it('never mirrors the QR code, whose modules are data', () => {
    expect(iconDirectionClass('qr-code')).toBe('');
  });

  it('decides every icon it knows', () => {
    expect(FLOW_ICONS.filter(isMirroredIcon)).toEqual(MIRRORED);
  });

  it('puts the class on the icon element', () => {
    const { container } = render(
      <svg data-icon="back" className={iconDirectionClass('back')} aria-hidden="true" />,
    );

    expect(container.querySelector('svg')).toHaveClass('rtl:-scale-x-100');
  });
});

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Icons drawn before this rule, each naming the icon it is. */
const NAMED_BEFORE_THE_RULE: Readonly<Record<string, FlowIcon>> = {
  'handoff/qr-code.tsx': 'qr-code',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('every icon the flow draws follows the rule', () => {
  it('names its kind with data-icon and takes its class from iconDirectionClass', () => {
    const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path).replaceAll('\\', '/');
      const source = readFileSync(path, 'utf8');
      if (!source.includes('<svg') || file === 'i18n/icon-direction.test.tsx') {
        return [];
      }
      if (NAMED_BEFORE_THE_RULE[file] !== undefined) {
        return [];
      }
      const named = source.includes('data-icon=') && source.includes('iconDirectionClass(');
      return named ? [] : [file];
    });

    expect(offenders).toEqual([]);
  });
});
