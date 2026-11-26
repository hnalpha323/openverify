import { describe, expect, it } from 'vitest';
import { cursorFromNextLink, listHref, parseCursor } from './list-query';

const ACCOUNT = 'acc_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

describe('listHref', () => {
  it('builds a list URL from its query, leaving out empty values', () => {
    expect(listHref('/accounts', { status: 'active', tag: undefined, 'reference-id': '' })).toBe(
      '/accounts?status=active',
    );
    expect(listHref('/accounts', {})).toBe('/accounts');
  });

  it('repeats a key for several values', () => {
    expect(listHref('/accounts', { status: ['active', 'archived'] })).toBe(
      '/accounts?status=active&status=archived',
    );
  });
});

describe('parseCursor', () => {
  it('keeps a well-formed ID of the list', () => {
    expect(parseCursor(ACCOUNT, 'acc')).toBe(ACCOUNT);
  });

  it.each([undefined, ['a', 'b'], 'acc_x', 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z'])(
    'ignores %j',
    (value) => {
      expect(parseCursor(value, 'acc')).toBeUndefined();
    },
  );
});

describe('cursorFromNextLink', () => {
  it("reads page[after] from the API's next link", () => {
    expect(
      cursorFromNextLink(`/api/v1/accounts?page%5Bsize%5D=25&page%5Bafter%5D=${ACCOUNT}`, 'acc'),
    ).toBe(ACCOUNT);
  });

  it('is null on the last page, or for a link without a well-formed cursor', () => {
    expect(cursorFromNextLink(null, 'acc')).toBeNull();
    expect(cursorFromNextLink('/api/v1/accounts?page%5Bafter%5D=nope', 'acc')).toBeNull();
    expect(cursorFromNextLink('/api/v1/accounts', 'acc')).toBeNull();
  });
});
