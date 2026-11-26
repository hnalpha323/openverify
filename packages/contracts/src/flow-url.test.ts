import { describe, expect, it } from 'vitest';
import {
  buildFlowUrl,
  buildOneTimeLinkUrl,
  parseFlowLinkFragment,
  parseFlowUrlFragment,
  parseOneTimeLinkFragment,
} from './flow-url.js';

const inquiryId = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const sessionToken = `ovs_${'A'.repeat(21)}-_${'b'.repeat(20)}`;
const oneTimeToken = `ovo_${'C'.repeat(21)}_-${'d'.repeat(20)}`;

describe('buildFlowUrl', () => {
  it('puts the inquiry id and session token in the fragment, never the query', () => {
    const url = buildFlowUrl('https://flow.example.test', inquiryId, sessionToken);
    expect(url).toBe(
      `https://flow.example.test/#inquiry-id=${inquiryId}&session-token=${sessionToken}`,
    );
    const parsed = new URL(url);
    expect(parsed.search).toBe('');
    expect(parsed.hash).toContain(sessionToken);
  });

  it('keeps a base path and drops trailing slashes', () => {
    expect(buildFlowUrl('http://localhost:5173/verify//', inquiryId, sessionToken)).toBe(
      `http://localhost:5173/verify/#inquiry-id=${inquiryId}&session-token=${sessionToken}`,
    );
  });

  it.each([
    ['a relative URL', '/flow'],
    ['a non-HTTP scheme', 'javascript:alert(1)'],
    ['a query string', 'https://flow.example.test/?a=1'],
    ['a fragment', 'https://flow.example.test/#x'],
    ['credentials', 'https://user:pw@flow.example.test'],
  ])('rejects a base URL with %s', (_name, base) => {
    expect(() => buildFlowUrl(base, inquiryId, sessionToken)).toThrow(TypeError);
  });

  it('rejects malformed ids and tokens', () => {
    expect(() => buildFlowUrl('https://flow.example.test', 'inq_1', sessionToken)).toThrow(
      TypeError,
    );
    expect(() => buildFlowUrl('https://flow.example.test', inquiryId, 'ovs_short')).toThrow(
      TypeError,
    );
  });
});

describe('parseFlowUrlFragment', () => {
  it('round-trips buildFlowUrl', () => {
    const url = new URL(buildFlowUrl('https://flow.example.test', inquiryId, sessionToken));
    expect(parseFlowUrlFragment(url.hash)).toEqual({ inquiryId, sessionToken });
  });

  it('accepts the fragment without the leading #', () => {
    expect(parseFlowUrlFragment(`session-token=${sessionToken}&inquiry-id=${inquiryId}`)).toEqual({
      inquiryId,
      sessionToken,
    });
  });

  it.each([
    ['empty', ''],
    ['missing token', `#inquiry-id=${inquiryId}`],
    ['missing inquiry id', `#session-token=${sessionToken}`],
    ['malformed inquiry id', `#inquiry-id=inq_x&session-token=${sessionToken}`],
    ['malformed token', `#inquiry-id=${inquiryId}&session-token=ovu_${'A'.repeat(43)}`],
    [
      'duplicated token',
      `#inquiry-id=${inquiryId}&session-token=${sessionToken}&session-token=${sessionToken}`,
    ],
  ])('returns null when %s', (_name, hash) => {
    expect(parseFlowUrlFragment(hash)).toBeNull();
  });
});

describe('buildOneTimeLinkUrl (C10)', () => {
  it('puts the inquiry id and one-time token in the fragment', () => {
    const url = buildOneTimeLinkUrl('https://flow.example.test/', inquiryId, oneTimeToken);
    expect(url).toBe(
      `https://flow.example.test/#inquiry-id=${inquiryId}&one-time-token=${oneTimeToken}`,
    );
    expect(new URL(url).search).toBe('');
  });

  it('rejects a bad base URL, inquiry id or token', () => {
    expect(() => buildOneTimeLinkUrl('/flow', inquiryId, oneTimeToken)).toThrow(TypeError);
    expect(() => buildOneTimeLinkUrl('https://flow.example.test', 'inq_1', oneTimeToken)).toThrow(
      TypeError,
    );
    expect(() => buildOneTimeLinkUrl('https://flow.example.test', inquiryId, sessionToken)).toThrow(
      TypeError,
    );
  });
});

describe('parseOneTimeLinkFragment', () => {
  it('round-trips buildOneTimeLinkUrl', () => {
    const url = new URL(buildOneTimeLinkUrl('https://flow.example.test', inquiryId, oneTimeToken));
    expect(parseOneTimeLinkFragment(url.hash)).toEqual({ inquiryId, oneTimeToken });
  });

  it.each([
    ['empty', ''],
    ['missing token', `#inquiry-id=${inquiryId}`],
    ['a session token instead', `#inquiry-id=${inquiryId}&one-time-token=${sessionToken}`],
    [
      'duplicated token',
      `#inquiry-id=${inquiryId}&one-time-token=${oneTimeToken}&one-time-token=${oneTimeToken}`,
    ],
  ])('returns null when %s', (_name, hash) => {
    expect(parseOneTimeLinkFragment(hash)).toBeNull();
  });
});

describe('parseFlowLinkFragment (C19)', () => {
  it('recognises a session link', () => {
    expect(parseFlowLinkFragment(`#inquiry-id=${inquiryId}&session-token=${sessionToken}`)).toEqual(
      { kind: 'session', inquiryId, sessionToken },
    );
  });

  it('recognises a one-time link', () => {
    expect(
      parseFlowLinkFragment(`#inquiry-id=${inquiryId}&one-time-token=${oneTimeToken}`),
    ).toEqual({ kind: 'one-time-link', inquiryId, oneTimeToken });
  });

  it.each([
    [
      'carries both credentials',
      `#inquiry-id=${inquiryId}&session-token=${sessionToken}&one-time-token=${oneTimeToken}`,
    ],
    ['carries neither', `#inquiry-id=${inquiryId}`],
    ['is malformed', '#%%%'],
  ])('returns null when the fragment %s', (_name, hash) => {
    expect(parseFlowLinkFragment(hash)).toBeNull();
  });
});
