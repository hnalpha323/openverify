import type {
  DeviceResource,
  InquirySessionResource,
  NetworkResource,
} from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import {
  BROWSER_FINGERPRINT,
  DEVICE_CLASS,
  SIGNAL_IDS as IDS,
  SOURCE_SHA256,
  device,
  maskedDevice,
  maskedNetwork,
  maskedSession,
  network,
  phase7Session,
  phoneSession,
} from '../../testing/signals-fixtures';
import { ToastProvider } from '../toasts';
import { DbIpAttribution } from '../signals/db-ip-attribution';
import { InquirySessions } from './inquiry-sessions';

const done = () => Promise.resolve({ ok: true, data: undefined } as ActionResult);

function renderSessions(
  sessions: readonly InquirySessionResource[],
  included: readonly (DeviceResource | NetworkResource)[],
  masked = false,
) {
  render(
    <ToastProvider>
      <InquirySessions
        inquiryId={IDS.inquiry}
        sessions={sessions}
        included={included}
        masked={masked}
        canExpire={false}
        expire={vi.fn(done)}
        expireAll={vi.fn(() => Promise.resolve({ ok: true as const, data: { expiredCount: 0 } }))}
      />
    </ToastProvider>,
  );
}

const card = (id: string) => screen.getByRole('article', { name: `Session ${id}` });
const part = (id: string, name: string) => within(card(id)).getByRole('group', { name });
/** The description of `term` inside `scope`. */
const value = (scope: HTMLElement, term: string) =>
  within(scope).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;

const desktop = () => phase7Session();
const REJECTED_AT = '2026-10-21T10:00:00.000Z';
const included = () => [device(), network()];

describe('the DB-IP attribution line (C92.8)', () => {
  it('is the exact line, linking https://db-ip.com', () => {
    render(<DbIpAttribution />);

    expect(screen.getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
  });
});

describe('the Sessions section: one card per session (C108)', () => {
  it('renders each session as a card named by its id', () => {
    renderSessions([desktop(), phoneSession()], included());

    expect(screen.getByRole('list', { name: 'Inquiry sessions' })).toBeVisible();
    expect(card(IDS.session)).toBeVisible();
    expect(card(IDS.phoneSession)).toBeVisible();
  });

  it('lists the collection tiers the session collected (C94.6)', () => {
    renderSessions([desktop()], included());

    expect(value(card(IDS.session), 'Signals collected')).toHaveTextContent(
      'Session integrity, Device recognition',
    );
  });

  it('reads an empty tier list as "Nothing collected", never as a pass', () => {
    renderSessions([phase7Session({ 'signals-collected': [] })], included());

    expect(value(card(IDS.session), 'Signals collected')).toHaveTextContent('Nothing collected');
  });

  it('says when the server reports no tiers', () => {
    const attributes: Partial<InquirySessionResource['attributes']> = { ...desktop().attributes };
    delete attributes['signals-collected'];
    renderSessions(
      [{ ...desktop(), attributes: attributes as InquirySessionResource['attributes'] }],
      included(),
    );

    expect(value(card(IDS.session), 'Signals collected')).toHaveTextContent('Not reported');
  });
});

describe('the session device (C91.1, C91.2)', () => {
  it('shows the parsed fields, a missing one as unknown', () => {
    renderSessions([desktop()], included());

    const parsed = part(IDS.session, 'Device');
    expect(value(parsed, 'Operating system')).toHaveTextContent('Linux');
    expect(value(parsed, 'Browser')).toHaveTextContent('Chrome 140.0.0.0');
    expect(value(parsed, 'Device type')).toHaveTextContent('Desktop');
    expect(value(parsed, 'Device name')).toHaveTextContent('Unknown');
    expect(value(parsed, 'Mobile SDK')).toHaveTextContent('None');
  });

  it('shows the recorded device with its fingerprint and device class', () => {
    renderSessions([desktop()], included());

    const parsed = part(IDS.session, 'Device');
    expect(value(parsed, 'Browser fingerprint')).toHaveTextContent(BROWSER_FINGERPRINT);
    expect(value(parsed, 'Device class')).toHaveTextContent(DEVICE_CLASS);
    expect(value(parsed, 'Platform')).toHaveTextContent('Web');
    expect(value(parsed, 'Sessions on this device')).toHaveTextContent('2');
  });

  it('hides the fingerprints without pii:view, and still shows the device class (not PII)', () => {
    renderSessions(
      [maskedSession(desktop())],
      [maskedDevice(device()), maskedNetwork(network())],
      true,
    );

    const parsed = part(IDS.session, 'Device');
    expect(value(parsed, 'Browser fingerprint')).toHaveTextContent('Hidden');
    expect(value(parsed, 'Device class')).toHaveTextContent(DEVICE_CLASS);
    expect(within(card(IDS.session)).queryByText(BROWSER_FINGERPRINT)).toBeNull();
  });

  it('says when no device was recorded', () => {
    renderSessions([phase7Session({}, IDS.session, { device: null })], [network()]);

    expect(within(part(IDS.session, 'Device')).getByText(/No device was recorded/)).toBeVisible();
  });
});

describe('the session network facts (C91.3, C93)', () => {
  it('shows each fact with its tier, and a null fact as not evaluated with its reason', () => {
    renderSessions([desktop()], included());

    const facts = part(IDS.session, 'Network');
    expect(value(facts, 'Tor exit')).toHaveTextContent('Checked: not found');
    expect(value(facts, 'Tor exit')).toHaveTextContent('R');
    expect(value(facts, 'Cloud provider address')).toHaveTextContent(
      'Not evaluated: not in the lists we hold',
    );
    expect(value(facts, 'VPN network')).toHaveTextContent(
      'Not evaluated: not in the lists we hold',
    );
    expect(value(facts, 'VPN network')).toHaveTextContent('Beta');
    expect(value(facts, 'Proxy')).toHaveTextContent('Not evaluated: no provider is configured');
    expect(value(facts, 'Proxy')).toHaveTextContent('A');
    expect(within(facts).queryByText(/^No$/)).toBeNull();
  });

  it('reads a low threat level as "no listed risk found", with its limits', () => {
    renderSessions([desktop()], included());

    const level = value(part(IDS.session, 'Network'), 'Threat level');
    expect(level).toHaveTextContent('Low: no listed risk found');
    expect(level).toHaveTextContent('the VPN list is not exhaustive');
    expect(level).toHaveTextContent('proxies were not evaluated (no provider)');
    expect(level).not.toHaveTextContent(/safe/i);
  });

  it('shows the country, the place, the network and how the address was resolved', () => {
    renderSessions([desktop()], included());

    const facts = part(IDS.session, 'Network');
    expect(value(facts, 'Country')).toHaveTextContent('Example Land (ZZ), approximate');
    expect(value(facts, 'Region')).toHaveTextContent('Example Region');
    expect(value(facts, 'Location')).toHaveTextContent('-30, -140 (approximate)');
    expect(value(facts, 'Network (ASN)')).toHaveTextContent('AS64502 Example Residential');
    expect(value(facts, 'Address resolved by')).toHaveTextContent('Forwarded by a trusted proxy');
  });

  it('hides the place and the point without pii:view, and keeps the derived facts', () => {
    renderSessions(
      [maskedSession(desktop())],
      [maskedDevice(device()), maskedNetwork(network())],
      true,
    );

    const facts = part(IDS.session, 'Network');
    expect(value(facts, 'Region')).toHaveTextContent('Hidden');
    expect(value(facts, 'Location')).toHaveTextContent('Hidden');
    expect(value(facts, 'Country')).toHaveTextContent('Example Land (ZZ)');
  });

  it('shows the provenance of each source, labelling a sandbox source', () => {
    renderSessions([desktop()], included());

    const sources = within(part(IDS.session, 'Network')).getByRole('list', {
      name: 'Network data sources',
    });
    expect(sources).toHaveTextContent('openverify-sandbox-network');
    expect(sources).toHaveTextContent('Sandbox');
    expect(sources).toHaveTextContent('sync 3');
    expect(sources).toHaveTextContent(SOURCE_SHA256);
  });

  it('says when the session was not evaluated yet', () => {
    renderSessions([phase7Session({}, IDS.session, { network: null })], [device()]);

    expect(within(part(IDS.session, 'Network')).getByText(/not evaluated yet/i)).toBeVisible();
  });
});

describe('the handoff between sessions (C96.4, C96.7)', () => {
  it('links the phone session to the session it came from, with the method and time', () => {
    renderSessions(
      [desktop(), phoneSession()],
      [...included(), network({}, IDS.phoneNetwork, IDS.phoneSession)],
    );

    const handoff = part(IDS.phoneSession, 'Handoff');
    expect(value(handoff, 'Method')).toHaveTextContent('QR code or its link');
    expect(within(handoff).getByRole('link', { name: IDS.session })).toHaveAttribute(
      'href',
      `#session-${IDS.session}`,
    );
    expect(value(handoff, 'Redeemed (UTC)')).toHaveTextContent('Oct 20, 2026');
    expect(value(handoff, 'Distance')).toHaveTextContent('70,000 m (approximate)');
    expect(value(handoff, 'Country changed')).toHaveTextContent('No');
  });

  it('reads a null handoff fact as unknown, never as "no"', () => {
    renderSessions(
      [phoneSession({ 'handoff-distance-meters': null, 'handoff-country-changed': null })],
      [],
    );

    const handoff = part(IDS.phoneSession, 'Handoff');
    expect(value(handoff, 'Network changed')).toHaveTextContent('Unknown');
    expect(value(handoff, 'Distance')).toHaveTextContent('Unknown');
    expect(value(handoff, 'Country changed')).toHaveTextContent('Unknown');
  });

  it('marks a session the desktop rejected, in words, with when (C96.3, K7C-1)', () => {
    renderSessions([desktop(), phoneSession({ 'handoff-rejected-at': REJECTED_AT })], included());

    const rejected = value(part(IDS.phoneSession, 'Handoff'), 'Rejected (UTC)');
    expect(rejected).toHaveTextContent('Oct 21, 2026');
    expect(rejected).toHaveTextContent('The desktop said “this was not me”');
    expect(rejected).toHaveTextContent('its captures were cancelled');
  });

  it('reads a handoff the desktop kept as not rejected (C96.3, K7C-1)', () => {
    renderSessions([phoneSession({ 'handoff-rejected-at': null })], []);

    expect(value(part(IDS.phoneSession, 'Handoff'), 'Rejected (UTC)')).toHaveTextContent(
      'Not rejected',
    );
  });

  it('reads a member a server did not send as unknown, never as "not rejected" (K7C-1)', () => {
    renderSessions([phoneSession({ 'handoff-rejected-at': undefined })], []);

    expect(value(part(IDS.phoneSession, 'Handoff'), 'Rejected (UTC)')).toHaveTextContent('Unknown');
  });

  it('shows no handoff part on a session no handoff created', () => {
    renderSessions([desktop()], included());

    expect(within(card(IDS.session)).queryByRole('group', { name: 'Handoff' })).toBeNull();
  });
});

describe('the attribution on the Sessions section (C92.8)', () => {
  it('carries the DB-IP line when a session shows an IP location', () => {
    renderSessions([desktop()], included());

    expect(screen.getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
  });

  it('carries it for a handoff distance alone', () => {
    renderSessions(
      [
        phoneSession({
          'country-code': null,
          'country-name': null,
          latitude: null,
          longitude: null,
          'region-code': null,
          'region-name': null,
        }),
      ],
      [],
    );

    expect(screen.getByRole('link', { name: 'IP geolocation by DB-IP' })).toBeVisible();
  });

  it('leaves it out when no session shows a location', () => {
    renderSessions(
      [
        phase7Session(
          {
            'country-code': null,
            'country-name': null,
            latitude: null,
            longitude: null,
            'region-code': null,
            'region-name': null,
          },
          IDS.session,
          { network: null },
        ),
      ],
      [],
    );

    expect(screen.queryByRole('link', { name: 'IP geolocation by DB-IP' })).toBeNull();
  });
});
