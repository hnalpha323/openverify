/**
 * Phase 10 decision 66 (Workflow 10B Stage 3, integration-10b; C210.1, C211.9): the notices follow the
 * collection.
 * - `nativeApp.notice.session-integrity`, the Android SDK's words for `notice.session-integrity`, names
 *   what the probes read and that only codes are sent; the web's own text is unchanged.
 * - `notice.play-integrity` names Google as a recipient and what it receives, in every language.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES } from './languages';
import type { Messages } from './locales/en';

const MESSAGES: Readonly<Record<(typeof SUPPORTED_LANGUAGES)[number], Messages>> = CATALOGS;

function at(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === 'string' ? node : undefined;
}

describe.each(SUPPORTED_LANGUAGES)('the integrity notices in %s', (language) => {
  const messages = MESSAGES[language];

  it('names Google in notice.play-integrity, and differs from the session-integrity notice', () => {
    const text = at(messages, 'notice.play-integrity');
    expect(text).toEqual(expect.any(String));
    expect(text).toContain('Google');
    expect(text).not.toBe(at(messages, 'notice.session-integrity'));
  });

  it('keeps every text NFC', () => {
    for (const key of ['notice.play-integrity', 'nativeApp.notice.session-integrity']) {
      const text = at(messages, key) ?? '';
      expect(text.normalize('NFC'), key).toBe(text);
    }
  });
});

describe('the English Android session-integrity notice (decision 66)', () => {
  it('names the probes: build properties, the app’s own process, the mount table and known files, and that only codes go', () => {
    const text = at(CATALOGS.en, 'nativeApp.notice.session-integrity') ?? '';
    for (const words of [
      'build properties',
      'memory map',
      'thread names',
      'loaded classes',
      'mount table',
      'known files',
      'only',
    ]) {
      expect(text, words).toContain(words);
    }
  });

  it('leaves the web flow’s own session-integrity text unchanged', () => {
    expect(at(CATALOGS.en, 'notice.session-integrity')).toBe(
      'To protect your verification against fraud, this page checks how it is being used, such as whether a browser is automated. It does not read your keystrokes or what you type.',
    );
  });
});
