/** C56: the disposable list file and the most-specific match of a domain and its parents. */
import { describe, expect, it } from 'vitest';
import { matchDisposableDomain, parseDisposableDomainList } from './disposable-domains.js';

describe('parseDisposableDomainList (C56)', () => {
  it('reads one lower-cased domain per line, skipping blanks, comments and non-hosts', () => {
    const list = parseDisposableDomainList(
      [
        '# the CC0 list',
        'mailinator.example',
        '  Temp-Mail.Example  ',
        '',
        'sub.trash.example\r',
        'localhost',
        'not a domain.example',
        'bad_label.example',
        '-bad.example',
        '*.wild.example',
        'mailinator.example',
      ].join('\n'),
    );
    expect([...list].sort()).toEqual([
      'mailinator.example',
      'sub.trash.example',
      'temp-mail.example',
    ]);
  });

  it('parses an empty file to an empty set', () => {
    expect(parseDisposableDomainList('').size).toBe(0);
  });
});

describe('matchDisposableDomain (C56)', () => {
  const listed = new Set(['trash.example', 'deep.mail.example']);
  const none = { listed, allow: [], deny: [] };

  it('matches the domain itself at depth 0', () => {
    expect(matchDisposableDomain('trash.example', none)).toEqual({ kind: 'listed', depth: 0 });
  });

  it('walks up the parents down to two labels, without a public-suffix list', () => {
    expect(matchDisposableDomain('a.b.trash.example', none)).toEqual({ kind: 'listed', depth: 2 });
    expect(matchDisposableDomain('x.deep.mail.example', none)).toEqual({
      kind: 'listed',
      depth: 1,
    });
    expect(matchDisposableDomain('mail.example', none)).toBeNull();
    // A one-label parent is never looked up, so a list entry for a TLD matches nothing.
    expect(
      matchDisposableDomain('user.example', { listed: new Set(['example']), allow: [], deny: [] }),
    ).toBeNull();
  });

  it('lets the most specific level decide, the operator lists first at each level', () => {
    expect(
      matchDisposableDomain('trash.example', { listed, allow: ['trash.example'], deny: [] }),
    ).toEqual({ kind: 'allowed', depth: 0 });
    expect(
      matchDisposableDomain('ok.trash.example', { listed, allow: ['ok.trash.example'], deny: [] }),
    ).toEqual({ kind: 'allowed', depth: 0 });
    expect(
      matchDisposableDomain('bad.trash.example', { listed, allow: ['trash.example'], deny: [] }),
    ).toEqual({ kind: 'allowed', depth: 1 });
    expect(
      matchDisposableDomain('x.deep.mail.example', {
        listed,
        allow: ['mail.example'],
        deny: [],
      }),
    ).toEqual({ kind: 'listed', depth: 1 });
    expect(
      matchDisposableDomain('team.corp.example', { listed, allow: [], deny: ['corp.example'] }),
    ).toEqual({ kind: 'denied', depth: 1 });
  });

  it('matches the operator lists without the file', () => {
    const lists = { listed: null, allow: ['ok.example'], deny: ['disposable.test'] };
    expect(matchDisposableDomain('disposable.test', lists)).toEqual({ kind: 'denied', depth: 0 });
    expect(matchDisposableDomain('mx.ok.example', lists)).toEqual({ kind: 'allowed', depth: 1 });
    expect(matchDisposableDomain('other.example', lists)).toBeNull();
  });
});
