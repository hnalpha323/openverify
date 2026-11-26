import { describe, expect, it } from 'vitest';
import { apiOrigin, parseApiBaseUrl } from './api-base-url';

describe('parseApiBaseUrl', () => {
  it.each([undefined, '', '   '])('means the same origin when the value is %j', (value) => {
    expect(parseApiBaseUrl(value)).toBe('');
  });

  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://example.com/openverify/', 'https://example.com/openverify'],
    ['  https://api.example.com  ', 'https://api.example.com'],
    ['HTTPS://API.EXAMPLE.COM', 'https://api.example.com'],
  ])('normalises %s', (value, expected) => {
    expect(parseApiBaseUrl(value)).toBe(expected);
  });

  it.each([
    ['a relative path', '/api'],
    ['another scheme', 'ftp://api.example.com'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a query', 'https://api.example.com?x=1'],
    ['a fragment', 'https://api.example.com#x'],
    ['credentials', 'https://user:pass@api.example.com'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseApiBaseUrl(value)).toThrow(TypeError);
  });
});

describe('apiOrigin', () => {
  it('is null for the same origin', () => {
    expect(apiOrigin(undefined)).toBeNull();
    expect(apiOrigin('')).toBeNull();
  });

  it('is the origin of the API, without its path', () => {
    expect(apiOrigin('https://example.com/openverify')).toBe('https://example.com');
    expect(apiOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('rejects invalid values', () => {
    expect(() => apiOrigin('not a url')).toThrow(TypeError);
  });
});
