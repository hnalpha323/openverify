/**
 * C156.2 (review F09): the preview accepts a console message only from the exact console origin and
 * from `window.parent`, at most 1 MiB (assets at most 1 MiB in all), and only in the frozen shape.
 */
import { describe, expect, it } from 'vitest';
import { readConsoleMessage } from './protocol';

const CONSOLE = 'https://console.example.com';
const parent = { name: 'console window' };
const expected = { consoleOrigin: CONSOLE, parent };
const message = (body: Record<string, unknown>) => ({
  source: 'openverify-console',
  version: 1,
  ...body,
});
const event = (data: unknown, origin = CONSOLE, source: unknown = parent) => ({
  data,
  origin,
  source,
});

describe('readConsoleMessage (C156.2)', () => {
  it('accepts each message type of the console', () => {
    for (const data of [
      message({ type: 'select-step', 'step-id': 'consent' }),
      message({ type: 'set-outcome', 'step-id': 'id_card', outcome: 'failed' }),
      message({ type: 'set-viewport', width: 320 }),
      message({ type: 'set-scheme', scheme: 'dark' }),
      message({ type: 'preview-document', document: { data: {} } }),
      message({
        type: 'preview-assets',
        assets: [
          { 'asset-id': 'tsa_01M5CJXHG07XPHF3HRM6NREDH7', kind: 'logo', bytes: new ArrayBuffer(8) },
        ],
      }),
    ]) {
      expect(readConsoleMessage(event(data), expected), JSON.stringify(data)).not.toBeNull();
    }
  });

  it('ignores another origin, another window, and every message without a console origin', () => {
    const data = message({ type: 'set-scheme', scheme: 'dark' });
    expect(readConsoleMessage(event(data, 'https://evil.example.com'), expected)).toBeNull();
    expect(
      readConsoleMessage(event(data, 'https://console.example.com.evil.example'), expected),
    ).toBeNull();
    expect(readConsoleMessage(event(data, CONSOLE, {}), expected)).toBeNull();
    expect(readConsoleMessage(event(data, CONSOLE, null), expected)).toBeNull();
    expect(readConsoleMessage(event(data), { consoleOrigin: null, parent })).toBeNull();
  });

  it('ignores a malformed message', () => {
    for (const data of [
      null,
      'set-scheme',
      { type: 'set-scheme', scheme: 'dark' },
      message({ type: 'set-scheme', scheme: 'dark', extra: 1 }),
      { ...message({ type: 'set-scheme', scheme: 'dark' }), version: 2 },
      message({ type: 'set-viewport', width: 1024 }),
      message({ type: 'select-step', 'step-id': '../x' }),
      message({ type: 'navigate', to: 'https://example.com' }),
      message({
        type: 'preview-assets',
        assets: [{ 'asset-id': 'tsa_x', kind: 'logo', bytes: 'AAAA' }],
      }),
    ]) {
      expect(readConsoleMessage(event(data), expected), JSON.stringify(data)).toBeNull();
    }
  });

  it('ignores a message over 1 MiB, and assets over 1 MiB in all', () => {
    const big = message({
      type: 'preview-document',
      document: { padding: 'x'.repeat(1024 * 1024) },
    });
    expect(readConsoleMessage(event(big), expected)).toBeNull();

    const asset = (bytes: number) => ({
      'asset-id': 'tsa_01M5CJXHG07XPHF3HRM6NREDH7',
      kind: 'logo',
      bytes: new ArrayBuffer(bytes),
    });
    const fits = message({
      type: 'preview-assets',
      assets: [asset(512 * 1024), asset(512 * 1024)],
    });
    const over = message({
      type: 'preview-assets',
      assets: [asset(512 * 1024), asset(512 * 1024 + 1)],
    });
    expect(readConsoleMessage(event(fits), expected)).not.toBeNull();
    expect(readConsoleMessage(event(over), expected)).toBeNull();
  });
});
