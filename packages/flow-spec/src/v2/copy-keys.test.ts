/** C162.2: the frozen shape of the overridable copy keys; `api-templates` fills them. */
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_COPY_ATTRIBUTES,
  COMPONENT_COPY_MAX_LENGTH,
  COPY_KEYS,
  COPY_LEGAL_KINDS,
  COPY_PLACEHOLDER_SOURCE,
} from '../index.js';

describe('COPY_KEYS (C162.2)', () => {
  it('has the legal kinds and the component attributes of C162.2', () => {
    expect(COPY_LEGAL_KINDS).toEqual(['consent', 'notice', 'decision', 'retention']);
    expect(COMPONENT_COPY_ATTRIBUTES).toEqual(['label', 'hint', 'title', 'body', 'button', 'alt']);
    expect(COMPONENT_COPY_MAX_LENGTH).toBe(255);
  });

  it('reads one placeholder form, {name}', () => {
    const pattern = new RegExp(COPY_PLACEHOLDER_SOURCE, 'gu');
    expect(
      [...'Kept {days} days by {organization}'.matchAll(pattern)].map((match) => match[1]),
    ).toEqual(['days', 'organization']);
    expect('{{days}} {Days} {1x}'.match(pattern)).toEqual(['{days}']);
  });

  it('declares the consent, notice and terminal texts an operator may override, frozen', () => {
    expect(Object.isFrozen(COPY_KEYS)).toBe(true);
    const legal = Object.entries(COPY_KEYS)
      .filter(([, definition]) => definition.legal !== null)
      .map(([key, definition]) => `${key}:${String(definition.legal)}`);
    expect(legal).toEqual(
      expect.arrayContaining([
        'consent.biometric:consent',
        'consent.biometric-matching:consent',
        'consent.processing:consent',
        'consent.automated-decision:consent',
        'notice.session-integrity:notice',
        'notice.device-recognition:notice',
      ]),
    );
    for (const [key, definition] of Object.entries(COPY_KEYS)) {
      expect(definition.consent, key).toBe(key.startsWith('consent.') && definition.legal !== null);
      expect(definition.maxLength, key).toBeGreaterThan(0);
      expect(definition.maxLength, key).toBeLessThanOrEqual(10_000);
      for (const name of definition.placeholders) {
        expect(name, key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      }
    }
    expect(COPY_KEYS['consent.biometric-matching']?.placeholders).toContain('days');
    expect(COPY_KEYS['screen.continue']).toMatchObject({ legal: null, consent: false });
  });
});
