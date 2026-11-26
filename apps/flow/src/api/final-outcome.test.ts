import { problemSchema, problemTypeUri, type Problem } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FakeFlowApi } from '../testing/fake-flow-api';
import {
  GOLDEN_SELFIE_CAPTURE,
  GOLDEN_SELFIE_SUBMIT,
  PHASE5_VERIFICATION_IDS,
  VERIFICATION_IDS,
  fileResource,
  flowVerification,
  jpegBlob,
  pngFile,
} from '../testing/flow-fixtures';
import { GOLDEN_PROBLEMS } from '../testing/golden-problems';
import { finalOutcomeOf, withFinalOutcomes, type FinalOutcome } from './final-outcome';
import { FlowApiError } from './flow-api-client';

function problem(status: number, extra: Partial<Problem> = {}): Problem {
  return {
    type: 'about:blank',
    title: 'Error',
    status,
    detail: 'Error.',
    instance: '/api/v1/flow/session',
    requestId: 'req-1',
    ...extra,
  };
}

function http(status: number, extra?: Partial<Problem>, withProblem = true): FlowApiError {
  return new FlowApiError('http', `GET failed with HTTP ${String(status)}`, {
    status,
    problem: withProblem ? problem(status, extra) : null,
  });
}

describe('finalOutcomeOf', () => {
  it.each([
    [http(401, { code: 'session_expired' }), 'session-expired'],
    [http(401, { code: 'session_canceled' }), 'session-canceled'],
    [http(410, { type: problemTypeUri('redacted'), title: 'Redacted' }), 'redacted'],
    // A 410 from the flow API always means the inquiry was redacted (C9), body or not.
    [http(410, undefined, false), 'redacted'],
  ])('ends the flow for %o', (error, outcome) => {
    expect(finalOutcomeOf(error)).toBe(outcome);
  });

  it.each([
    ['inquiry_expired', 'inquiry-expired'],
    ['inquiry_redacted', 'redacted'],
    ['inquiry_finished', 'session-canceled'],
    [undefined, 'session-canceled'],
  ] as const)(
    'ends a session canceled with reason %s on its own screen (C25.8)',
    (reason, outcome) => {
      const error = http(401, {
        code: 'session_canceled',
        ...(reason === undefined ? {} : { reason }),
      });

      expect(finalOutcomeOf(error)).toBe(outcome);
    },
  );

  it('ignores a reason on an expired session: it was not canceled', () => {
    expect(finalOutcomeOf(http(401, { code: 'session_expired', reason: 'inquiry_expired' }))).toBe(
      'session-expired',
    );
  });

  describe('the golden problems (contracts/fixtures/problems: C25.8, Workflow 4B review K202)', () => {
    /** A session_canceled problem ends the flow on its screen; a selfie 409 is left to the step. */
    const OUTCOMES: Readonly<Record<string, FinalOutcome | null>> = {
      'session-canceled-inquiry-expired.json': 'inquiry-expired',
      'session-canceled-inquiry-finished.json': 'session-canceled',
      'session-canceled-inquiry-redacted.json': 'redacted',
      'selfie-capture-incomplete.json': null,
      'selfie-capture-invalid.json': null,
      'selfie-capture-limit.json': null,
      'selfie-capture-required.json': null,
    };

    it('covers every golden problem', () => {
      expect([...GOLDEN_PROBLEMS.keys()].sort()).toEqual(Object.keys(OUTCOMES).sort());
    });

    const errorOf = (name: string) => {
      const golden = problemSchema.parse(GOLDEN_PROBLEMS.get(name));
      return new FlowApiError('http', `failed with HTTP ${String(golden.status)}`, {
        status: golden.status,
        problem: golden,
      });
    };

    it.each(Object.entries(OUTCOMES).filter(([, outcome]) => outcome !== null))(
      '%s ends the flow on its own screen (%s)',
      (name, outcome) => {
        expect(finalOutcomeOf(errorOf(name))).toBe(outcome);
      },
    );

    it.each(Object.keys(OUTCOMES).filter((name) => OUTCOMES[name] === null))(
      '%s is left to the step that made the call',
      (name) => {
        expect(errorOf(name).status).toBe(409);
        expect(finalOutcomeOf(errorOf(name))).toBeNull();
      },
    );
  });

  it.each([
    ['an unknown token (401 without a code)', http(401)],
    ['a 401 with another code', http(401, { code: 'invalid_token' })],
    ['a conflict', http(409)],
    ['a server error', http(503)],
    ['a network error', new FlowApiError('network', 'no response')],
    ['a timeout', new FlowApiError('timeout', 'timed out')],
    ['something else', new TypeError('boom')],
  ])('leaves %s to the screen that made the call', (_label, error) => {
    expect(finalOutcomeOf(error)).toBeNull();
  });
});

describe('withFinalOutcomes', () => {
  it('passes calls and answers through unchanged', async () => {
    const api = new FakeFlowApi();
    const onFinal = vi.fn();
    const client = withFinalOutcomes(api.client, onFinal);

    const session = await client.getSession();
    await client.acceptConsent({
      accepted: true,
      'text-keys': ['consent.biometric'],
      locale: 'en',
    });
    const created = await client.createVerification({ type: 'government-id' });
    await client.uploadFile(created.id, 'front', pngFile());
    await client.submitVerification(created.id);
    await client.getVerification(created.id);

    expect(session.inquiry.status).toBe('pending');
    expect(api.uploadedKinds()).toEqual(['front']);
    expect(onFinal).not.toHaveBeenCalled();
  });

  it('reports a final answer of any call, then still rejects with it', async () => {
    const api = new FakeFlowApi();
    const expired = http(401, { code: 'session_expired' });
    const redacted = http(410);
    api.client.getSession.mockRejectedValueOnce(expired);
    api.client.uploadFile.mockRejectedValueOnce(redacted);
    const onFinal = vi.fn();
    const client = withFinalOutcomes(api.client, onFinal);

    await expect(client.getSession()).rejects.toBe(expired);
    await expect(client.uploadFile(VERIFICATION_IDS.governmentId, 'front', pngFile())).rejects.toBe(
      redacted,
    );

    expect(onFinal.mock.calls).toEqual([['session-expired'], ['redacted']]);
  });

  it('passes a selfie capture’s calls through with every argument (C40)', async () => {
    const api = new FakeFlowApi();
    const id = VERIFICATION_IDS.selfie;
    const signal = new AbortController().signal;
    const fields = {
      captureId: GOLDEN_SELFIE_CAPTURE.id,
      nonce: GOLDEN_SELFIE_CAPTURE.attributes.nonce,
      clientElapsedMs: 1200,
    };
    api.client.createSelfieCapture.mockResolvedValueOnce(GOLDEN_SELFIE_CAPTURE);
    api.client.uploadFile.mockResolvedValueOnce(fileResource(id, 'selfie-center'));
    api.client.submitVerification.mockResolvedValueOnce(flowVerification('selfie', 'submitted'));
    const client = withFinalOutcomes(api.client, vi.fn());

    await expect(client.createSelfieCapture(id, { method: 'camera' }, signal)).resolves.toBe(
      GOLDEN_SELFIE_CAPTURE,
    );
    const photo = jpegBlob();
    await client.uploadFile(id, 'selfie-center', photo, signal, fields);
    await client.submitVerification(id, signal, GOLDEN_SELFIE_SUBMIT);

    expect(api.client.createSelfieCapture).toHaveBeenCalledWith(id, { method: 'camera' }, signal);
    expect(api.client.uploadFile).toHaveBeenCalledWith(id, 'selfie-center', photo, signal, fields);
    expect(api.client.submitVerification).toHaveBeenCalledWith(id, signal, GOLDEN_SELFIE_SUBMIT);
  });

  it('reports a final answer to a capture create', async () => {
    const api = new FakeFlowApi();
    const redacted = http(410);
    api.client.createSelfieCapture.mockRejectedValueOnce(redacted);
    const onFinal = vi.fn();

    await expect(
      withFinalOutcomes(api.client, onFinal).createSelfieCapture(VERIFICATION_IDS.selfie, {
        method: 'camera',
      }),
    ).rejects.toBe(redacted);
    expect(onFinal).toHaveBeenCalledWith('redacted');
  });

  it('passes the Phase 5 calls through with every argument (C64.1)', async () => {
    const api = new FakeFlowApi();
    const signal = new AbortController().signal;
    const phone = PHASE5_VERIFICATION_IDS.phone_number;
    const database = PHASE5_VERIFICATION_IDS.database;
    const wallet = PHASE5_VERIFICATION_IDS.crypto_wallet;
    const sent = flowVerification('phone_number', 'initiated');
    const confirmed = flowVerification('phone_number', 'confirmed');
    const received = flowVerification('database', 'initiated', { inputsReceived: true });
    const challenge = {
      id: 'cwc_01M5CK5AAB0000000000000C01',
      message: 'Sign this message.',
      'expires-at': '2026-10-20T12:10:00.000Z',
    };
    api.client.sendOtp.mockResolvedValueOnce(sent);
    api.client.confirmOtp.mockResolvedValueOnce(confirmed);
    api.client.enterInputs.mockResolvedValueOnce(received);
    api.client.createCryptoChallenge.mockResolvedValueOnce(challenge);
    const client = withFinalOutcomes(api.client, vi.fn());

    await expect(client.sendOtp(phone, { 'phone-number': '+447700900123' }, signal)).resolves.toBe(
      sent,
    );
    await expect(client.confirmOtp(phone, { code: '123456' }, signal)).resolves.toBe(confirmed);
    await expect(client.enterInputs(database, { 'name-first': 'Alex' }, signal)).resolves.toBe(
      received,
    );
    const body = { 'chain-id': 'eip155:1', 'wallet-address': '0xabc' };
    await expect(client.createCryptoChallenge(wallet, body, signal)).resolves.toBe(challenge);

    expect(api.client.sendOtp).toHaveBeenCalledWith(
      phone,
      { 'phone-number': '+447700900123' },
      signal,
    );
    expect(api.client.confirmOtp).toHaveBeenCalledWith(phone, { code: '123456' }, signal);
    expect(api.client.enterInputs).toHaveBeenCalledWith(database, { 'name-first': 'Alex' }, signal);
    expect(api.client.createCryptoChallenge).toHaveBeenCalledWith(wallet, body, signal);
  });

  it.each(['sendOtp', 'confirmOtp', 'enterInputs', 'createCryptoChallenge'] as const)(
    'reports a final answer to %s, then still rejects with it',
    async (method) => {
      const api = new FakeFlowApi();
      const redacted = http(410);
      const id = PHASE5_VERIFICATION_IDS.phone_number;
      const onFinal = vi.fn();
      const client = withFinalOutcomes(api.client, onFinal);
      const calls = {
        sendOtp: () => {
          api.client.sendOtp.mockRejectedValueOnce(redacted);
          return client.sendOtp(id, { 'phone-number': '+447700900123' });
        },
        confirmOtp: () => {
          api.client.confirmOtp.mockRejectedValueOnce(redacted);
          return client.confirmOtp(id, { code: '123456' });
        },
        enterInputs: () => {
          api.client.enterInputs.mockRejectedValueOnce(redacted);
          return client.enterInputs(id, { 'name-first': 'Alex' });
        },
        createCryptoChallenge: () => {
          api.client.createCryptoChallenge.mockRejectedValueOnce(redacted);
          return client.createCryptoChallenge(id, {
            'chain-id': 'eip155:1',
            'wallet-address': 'x',
          });
        },
      };

      await expect(calls[method]()).rejects.toBe(redacted);
      expect(onFinal).toHaveBeenCalledWith('redacted');
    },
  );

  it('does not report errors a retry can fix', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockRejectedValueOnce(new FlowApiError('network', 'no response'));
    const onFinal = vi.fn();

    await expect(withFinalOutcomes(api.client, onFinal).getSession()).rejects.toBeInstanceOf(
      FlowApiError,
    );

    expect(onFinal).not.toHaveBeenCalled();
  });
});
