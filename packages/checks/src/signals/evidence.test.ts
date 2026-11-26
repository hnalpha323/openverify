import { describe, expect, it } from 'vitest';
import { sessionEvidence } from './evidence.js';
import { AT, behaviour, cleanNetwork, integrity, session, webBody } from './testing.js';

describe('sessionEvidence (C94.8)', () => {
  it('merges the integrity member over the bodies: any flag, the driver kinds once, the most untrusted events', () => {
    const evidence = sessionEvidence(
      session('iqse_1', {
        bodies: [
          webBody(2, {
            integrity: integrity({
              'driver-globals': ['playwright'],
              'untrusted-event-count': 1,
              timezone: 'Europe/Paris',
              languages: ['fr'],
            }),
          }),
          webBody(1, {
            integrity: integrity({
              webdriver: true,
              'driver-globals': ['selenium', 'playwright'],
              'untrusted-event-count': 3,
              timezone: 'Asia/Tokyo',
            }),
          }),
        ],
      }),
      'production',
    );
    expect(evidence.integrity).toMatchObject({
      webdriver: true,
      'driver-globals': ['selenium', 'playwright'],
      'untrusted-event-count': 3,
      timezone: 'Europe/Paris',
      languages: ['fr'],
    });
    expect(evidence.sentPayload).toBe(true);
    expect(evidence.at).toEqual(AT);
  });

  it('keeps one screen per body with behaviour, in sequence order, and the newest request facts', () => {
    const evidence = sessionEvidence(
      session('iqse_1', {
        bodies: [
          webBody(3, { behaviour: behaviour({ 'dwell-seconds': 3 }) }),
          webBody(1, {
            behaviour: behaviour({ 'dwell-seconds': 1 }),
            requestHeaders: { acceptLanguages: ['en'], clientHints: null },
          }),
          webBody(2, {
            requestHeaders: { acceptLanguages: ['de'], clientHints: null },
          }),
        ],
      }),
      'production',
    );
    expect(
      evidence.screens.map(({ screen, behaviour: aggregates }) => [
        screen,
        aggregates['dwell-seconds'],
      ]),
    ).toEqual([
      ['step_1', 1],
      ['step_3', 3],
    ]);
    expect(evidence.requestHeaders).toEqual({ acceptLanguages: ['de'], clientHints: null });
    expect(evidence.integrity).toBeNull();
  });

  it('keeps the IP country only when it is reliable (not Tor, VPN, provider range or relay)', () => {
    expect(sessionEvidence(session('iqse_1'), 'production').ipCountry).toBe('ZZ');
    for (const unreliable of [
      cleanNetwork({ isTor: true }),
      cleanNetwork({ isVpn: true }),
      cleanNetwork({ isDatacenter: true }),
      cleanNetwork({ privacyRelay: true }),
    ]) {
      expect(
        sessionEvidence(session('iqse_1', { network: unreliable }), 'production').ipCountry,
      ).toBeNull();
    }
    expect(
      sessionEvidence(session('iqse_1', { network: null }), 'production').ipCountry,
    ).toBeNull();
  });

  it('honours a sandbox outcome only in a sandbox environment (C90.9)', () => {
    const bodies = [webBody(1, { sandboxOutcome: 'human' }), webBody(2, { sandboxOutcome: 'bot' })];
    expect(sessionEvidence(session('iqse_1', { bodies }), 'sandbox').sandboxOutcome).toBe('bot');
    expect(sessionEvidence(session('iqse_1', { bodies }), 'production').sandboxOutcome).toBeNull();
  });

  it('says when a session sent nothing', () => {
    expect(sessionEvidence(session('iqse_1'), 'production')).toMatchObject({
      sentPayload: false,
      integrity: null,
      screens: [],
      requestHeaders: null,
      sandboxOutcome: null,
    });
  });
});
