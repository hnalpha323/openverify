import { describe, expect, it } from 'vitest';
import { compactOpenApi, renderOpenApiDocument } from './openapi.js';

const served = '{"openapi":"3.1.0","info":{"title":"t","version":"1"},"paths":{"/a":{"get":{}}}}';

describe('compactOpenApi', () => {
  it('gives the served body and its formatted file one text', async () => {
    const formatted = await renderOpenApiDocument({
      inject: () => Promise.resolve({ statusCode: 200, body: served }),
    } as never);
    expect(formatted).not.toBe(served);
    expect(compactOpenApi(formatted)).toBe(compactOpenApi(served));
  });

  it('tells a changed value apart', () => {
    expect(compactOpenApi(served.replace('"1"', '"2"'))).not.toBe(compactOpenApi(served));
  });

  it('tells a changed key order apart, which a plain deep comparison would miss', () => {
    const reordered =
      '{"info":{"title":"t","version":"1"},"openapi":"3.1.0","paths":{"/a":{"get":{}}}}';
    expect(JSON.parse(reordered)).toEqual(JSON.parse(served));
    expect(compactOpenApi(reordered)).not.toBe(compactOpenApi(served));
  });
});

describe('renderOpenApiDocument', () => {
  it('refuses a document the server did not serve', async () => {
    await expect(
      renderOpenApiDocument({
        inject: () => Promise.resolve({ statusCode: 500, body: 'boom' }),
      } as never),
    ).rejects.toThrow('/openapi.json answered 500: boom');
  });
});
