/**
 * C159.2 (C149.4, C159.3): the frame's URL carries the credentials only in the fragment, in the
 * hosted link's form, and only `language` and `style-variant` in the query. Every token is
 * synthetic.
 */
import { parseFlowLinkFragment } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { frameUrlOf } from './frame-url';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const SESSION_TOKEN = `ovs_${'SdkSyntheticSessionToken'.padEnd(43, 'x')}`;
const ONE_TIME_TOKEN = `ovo_${'SdkSyntheticOneTimeToken'.padEnd(43, 'x')}`;
const FLOW = 'https://flow.example.com';

const url = (result: ReturnType<typeof frameUrlOf>): URL => {
  if ('invalid' in result) {
    throw new Error(result.invalid);
  }
  return new URL(result.url);
};

describe('frameUrlOf (C159.2)', () => {
  it('opens /embed/{inquiry id} with a session token in the fragment only', () => {
    const result = frameUrlOf({
      flowUrl: FLOW,
      inquiryId: INQUIRY_ID,
      sessionToken: SESSION_TOKEN,
    });
    const frame = url(result);

    expect(frame.origin).toBe(FLOW);
    expect(frame.pathname).toBe(`/embed/${INQUIRY_ID}`);
    expect(frame.search).toBe('');
    expect(parseFlowLinkFragment(frame.hash)).toEqual({
      kind: 'session',
      inquiryId: INQUIRY_ID,
      sessionToken: SESSION_TOKEN,
    });
    expect('origin' in result && result.origin).toBe(FLOW);
  });

  it('carries a one-time token the same way', () => {
    const frame = url(
      frameUrlOf({ flowUrl: FLOW, inquiryId: INQUIRY_ID, oneTimeLink: ONE_TIME_TOKEN }),
    );
    expect(parseFlowLinkFragment(frame.hash)).toMatchObject({
      inquiryId: INQUIRY_ID,
      oneTimeToken: ONE_TIME_TOKEN,
    });
    expect(frame.href).not.toContain(SESSION_TOKEN);
  });

  it('puts language and style-variant in the query, and nothing else there', () => {
    const frame = url(
      frameUrlOf({
        flowUrl: `${FLOW}/verify/`,
        inquiryId: INQUIRY_ID,
        sessionToken: SESSION_TOKEN,
        language: 'ar',
        styleVariant: 'dark',
      }),
    );
    expect(frame.pathname).toBe(`/verify/embed/${INQUIRY_ID}`);
    expect([...frame.searchParams]).toEqual([
      ['language', 'ar'],
      ['style-variant', 'dark'],
    ]);
    expect(frame.search).not.toContain('ovs_');
  });

  it('allows http for a loopback flow only', () => {
    expect(
      'url' in
        frameUrlOf({
          flowUrl: 'http://localhost:5173',
          inquiryId: INQUIRY_ID,
          sessionToken: SESSION_TOKEN,
        }),
    ).toBe(true);
    expect(
      'url' in
        frameUrlOf({
          flowUrl: 'http://127.0.0.1:4173',
          inquiryId: INQUIRY_ID,
          sessionToken: SESSION_TOKEN,
        }),
    ).toBe(true);
    expect(
      frameUrlOf({
        flowUrl: 'http://flow.example.com',
        inquiryId: INQUIRY_ID,
        sessionToken: SESSION_TOKEN,
      }),
    ).toEqual({
      invalid: expect.stringContaining('flowUrl') as unknown,
    });
  });

  it('refuses what it cannot embed safely, naming the option and never the value', () => {
    const cases = [
      { flowUrl: 'flow.example.com', inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN },
      { flowUrl: `${FLOW}?x=1`, inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN },
      { flowUrl: `${FLOW}#x`, inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN },
      {
        flowUrl: 'https://user:pass@flow.example.com',
        inquiryId: INQUIRY_ID,
        sessionToken: SESSION_TOKEN,
      },
      { flowUrl: 'javascript:alert(1)', inquiryId: INQUIRY_ID, sessionToken: SESSION_TOKEN },
      { flowUrl: FLOW, inquiryId: 'inq_bad', sessionToken: SESSION_TOKEN },
      { flowUrl: FLOW, inquiryId: INQUIRY_ID },
      {
        flowUrl: FLOW,
        inquiryId: INQUIRY_ID,
        sessionToken: SESSION_TOKEN,
        oneTimeLink: ONE_TIME_TOKEN,
      },
      { flowUrl: FLOW, inquiryId: INQUIRY_ID, sessionToken: 'ovs_short' },
      { flowUrl: FLOW, inquiryId: INQUIRY_ID, oneTimeLink: SESSION_TOKEN },
      {
        flowUrl: FLOW,
        inquiryId: INQUIRY_ID,
        sessionToken: SESSION_TOKEN,
        language: 'en"><script>',
      },
      {
        flowUrl: FLOW,
        inquiryId: INQUIRY_ID,
        sessionToken: SESSION_TOKEN,
        styleVariant: 'neon' as unknown as 'dark',
      },
    ];
    for (const input of cases) {
      const result = frameUrlOf(input);
      expect('invalid' in result, JSON.stringify(input)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('ovs_');
      expect(JSON.stringify(result)).not.toContain('ovo_');
    }
  });
});
