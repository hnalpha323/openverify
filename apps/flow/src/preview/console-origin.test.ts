/**
 * C156.2: the preview reads the console's origin from the `<meta>` the flow server writes, the one
 * origin its `frame-ancestors` allows, so the header and the message check cannot disagree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PREVIEW_CONSOLE_ORIGIN_META as SERVER_META } from '../../server.ts';
import { consoleOriginOf, PREVIEW_CONSOLE_ORIGIN_META } from './console-origin';

const withMeta = (content: string | null) => {
  document.head.innerHTML =
    content === null ? '' : `<meta name="${PREVIEW_CONSOLE_ORIGIN_META}" content="${content}">`;
};

afterEach(() => {
  document.head.innerHTML = '';
});

describe('consoleOriginOf (C156.2)', () => {
  it("names the flow server's meta", () => {
    expect(PREVIEW_CONSOLE_ORIGIN_META).toBe(SERVER_META);
  });

  it('reads an exact origin', () => {
    withMeta('https://console.example.com');
    expect(consoleOriginOf(document)).toBe('https://console.example.com');
    withMeta('http://localhost:3001');
    expect(consoleOriginOf(document)).toBe('http://localhost:3001');
  });

  it('answers null without the meta, or for anything but an exact http(s) origin', () => {
    withMeta(null);
    expect(consoleOriginOf(document)).toBeNull();
    for (const content of [
      '',
      '*',
      'console.example.com',
      'https://console.example.com/path',
      'https://console.example.com/',
      'javascript:alert(1)',
      'https://user@console.example.com',
    ]) {
      withMeta(content);
      expect(consoleOriginOf(document), content).toBeNull();
    }
  });
});
