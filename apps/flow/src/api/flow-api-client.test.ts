import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOLDEN_SELFIE_CAPTURE,
  GOLDEN_SELFIE_SUBMIT,
  INQUIRY_ID,
  PHASE5_VERIFICATION_IDS,
  SESSION_TOKEN,
  VERIFICATION_IDS,
  fileResource,
  flowSession,
  flowVerification,
  jpegBlob,
  pdfFile,
  pngFile,
} from '../testing/flow-fixtures';
import { GOLDEN_FLOW_PROBLEMS, GOLDEN_PROBLEMS } from '../testing/golden-problems';
import { FlowApiError, createFlowApiClient, type FlowApiClient } from './flow-api-client';

const BASE_URL = 'https://api.example.com';
const VERIFICATION_ID = VERIFICATION_IDS.governmentId;

interface Call {
  url: string;
  init: RequestInit;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function jsonBody(call: Call | undefined): unknown {
  const body = call?.init.body;
  if (typeof body !== 'string') {
    throw new TypeError('expected a JSON string body');
  }
  return JSON.parse(body);
}

function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

function problem(status: number, title: string): Response {
  return json(
    {
      type: 'about:blank',
      title,
      status,
      detail: `${title}.`,
      instance: '/api/v1/flow/session',
      requestId: 'req-1',
    },
    status,
    'application/problem+json',
  );
}

function clientReturning(...responses: (Response | Error)[]): {
  client: FlowApiClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchStub = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: requestUrl(input), init });
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error('unexpected request'));
    }
    return next instanceof Response ? Promise.resolve(next) : Promise.reject(next);
  });
  return {
    client: createFlowApiClient({
      baseUrl: BASE_URL,
      sessionToken: SESSION_TOKEN,
      fetch: fetchStub,
    }),
    calls,
  };
}

function headers(call: Call | undefined): Headers {
  return new Headers(call?.init.headers);
}

async function caught(promise: Promise<unknown>): Promise<FlowApiError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof FlowApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('createFlowApiClient', () => {
  describe('every request', () => {
    it('sends the session token as a bearer token and asks for JSON', async () => {
      const { client, calls } = clientReturning(json(flowSession()));

      await client.getSession();

      expect(headers(calls[0]).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(headers(calls[0]).get('accept')).toBe('application/json, application/problem+json');
    });

    it('omits cookies, caching and the referrer', async () => {
      const { client, calls } = clientReturning(json(flowSession()));

      await client.getSession();

      expect(calls[0]?.init).toMatchObject({
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    });

    it('never puts the token in the URL', async () => {
      const { client, calls } = clientReturning(json(flowSession()));

      await client.getSession();

      expect(calls[0]?.url).not.toContain(SESSION_TOKEN);
    });

    it('calls the flow’s own origin when no base URL is configured', async () => {
      const fetchStub = vi.fn(() => Promise.resolve(json(flowSession())));
      const client = createFlowApiClient({
        baseUrl: '',
        sessionToken: SESSION_TOKEN,
        fetch: fetchStub,
      });

      await client.getSession();

      expect(fetchStub).toHaveBeenCalledWith('/api/v1/flow/session', expect.any(Object));
    });

    it('keeps a path prefix in the base URL', async () => {
      const fetchStub = vi.fn(() => Promise.resolve(json(flowSession())));
      const client = createFlowApiClient({
        baseUrl: 'https://example.com/openverify',
        sessionToken: SESSION_TOKEN,
        fetch: fetchStub,
      });

      await client.getSession();

      expect(fetchStub).toHaveBeenCalledWith(
        'https://example.com/openverify/api/v1/flow/session',
        expect.any(Object),
      );
    });

    it('aborts the request when the caller’s signal aborts', async () => {
      const controller = new AbortController();
      const signals: (AbortSignal | null | undefined)[] = [];
      const client = createFlowApiClient({
        baseUrl: BASE_URL,
        sessionToken: SESSION_TOKEN,
        fetch: (_input, init) => {
          signals.push(init?.signal);
          controller.abort();
          return Promise.resolve(json(flowSession()));
        },
      });

      await expect(caught(client.getSession(controller.signal))).resolves.toMatchObject({
        kind: 'aborted',
      });
      // The request has its own signal (it also carries the timeout), which follows the caller's.
      expect(signals[0]).not.toBe(controller.signal);
      expect(signals[0]?.aborted).toBe(true);
    });

    it('uses the global fetch by default', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(flowSession()));
      try {
        await createFlowApiClient({ baseUrl: BASE_URL, sessionToken: SESSION_TOKEN }).getSession();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('getSession', () => {
    it('GETs the session and parses it with the contract schema', async () => {
      const session = flowSession({ consent: true });
      const { client, calls } = clientReturning(json(session));

      await expect(client.getSession()).resolves.toEqual(session);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/session`,
        init: { method: 'GET' },
      });
      expect(calls[0]?.init.body).toBeUndefined();
    });
  });

  describe('sendSignals (C94.2, Workflow 7A)', () => {
    const body = {
      platform: 'web',
      'collector-version': 1,
      screen: 'consent',
      sequence: 0,
    } as const;

    it('POSTs the body as JSON to /flow/signals and resolves on the 202', async () => {
      const { client, calls } = clientReturning(json(null, 202));

      await expect(client.sendSignals(body)).resolves.toBeUndefined();

      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/signals`,
        init: { method: 'POST' },
      });
      expect(headers(calls[0]).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(jsonBody(calls[0])).toEqual(body);
    });

    it('asks the browser to keep the request alive, so a body outlives the page (K7A-11)', async () => {
      const { client, calls } = clientReturning(json(null, 202));

      await client.sendSignals(body);

      expect(calls[0]?.init).toMatchObject({ keepalive: true });
    });

    it('rejects with the problem of a refusal', async () => {
      const { client } = clientReturning(problem(409, 'Conflict'));

      expect((await caught(client.sendSignals(body))).status).toBe(409);
    });
  });

  describe('the handoff calls (C96.3, Workflow 7A)', () => {
    const CURRENT = {
      status: 'continued_here',
      'redeemed-at': null,
      'os-name': null,
      'browser-name': null,
    } as const;

    it('POSTs an issue to /flow/handoffs and returns its answer', async () => {
      const answer = {
        id: 'hnd_01M5CK16P0D13FXHZSS4TCFBVH',
        method: 'email',
        'expires-at': '2026-10-20T12:15:00.000Z',
        'confirmation-code': '042917',
      };
      const { client, calls } = clientReturning(json(answer, 201));

      await expect(
        client.createHandoff({ method: 'email', destination: 'person@example.test' }),
      ).resolves.toEqual(answer);

      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/handoffs`,
        init: { method: 'POST' },
      });
      expect(headers(calls[0]).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
      expect(jsonBody(calls[0])).toEqual({ method: 'email', destination: 'person@example.test' });
    });

    it('POSTs continue-here and a rejection, and GETs the current handoff', async () => {
      const { client, calls } = clientReturning(
        json(CURRENT),
        json({ ...CURRENT, status: 'issued' }),
        json({ ...CURRENT, status: 'rejected' }),
      );

      await expect(client.continueHandoffHere()).resolves.toEqual(CURRENT);
      await expect(client.getCurrentHandoff()).resolves.toMatchObject({ status: 'issued' });
      await expect(client.rejectHandoff()).resolves.toMatchObject({ status: 'rejected' });

      expect(calls.map((call) => [call.init.method, call.url])).toEqual([
        ['POST', `${BASE_URL}/api/v1/flow/handoffs/continue-here`],
        ['GET', `${BASE_URL}/api/v1/flow/handoffs/current`],
        ['POST', `${BASE_URL}/api/v1/flow/handoffs/current/reject`],
      ]);
      expect(jsonBody(calls[0])).toEqual({});
      expect(jsonBody(calls[2])).toEqual({});
    });

    it('rejects with the problem of a refusal', async () => {
      const { client } = clientReturning(problem(409, 'Conflict'));

      expect((await caught(client.continueHandoffHere())).status).toBe(409);
    });
  });

  describe('acceptConsent', () => {
    it('POSTs the consent body as JSON and returns the acceptance time', async () => {
      const { client, calls } = clientReturning(
        json({ consent: { 'accepted-at': '2026-10-20T12:00:30.000Z' } }, 201),
      );

      await expect(
        client.acceptConsent({
          accepted: true,
          'text-keys': ['consent.biometric', 'consent.processing'],
          locale: 'es',
        }),
      ).resolves.toEqual({ acceptedAt: '2026-10-20T12:00:30.000Z' });

      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/consent`,
        init: { method: 'POST' },
      });
      expect(headers(calls[0]).get('content-type')).toBe('application/json');
      expect(jsonBody(calls[0])).toEqual({
        accepted: true,
        'text-keys': ['consent.biometric', 'consent.processing'],
        locale: 'es',
      });
    });

    it('refuses to send a body that breaks the contract', async () => {
      const { client, calls } = clientReturning();

      await expect(
        client.acceptConsent({ accepted: true, 'text-keys': [], locale: 'en' }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });
  });

  describe('createVerification', () => {
    it('POSTs the verification type and returns the new verification', async () => {
      const verification = flowVerification('government_id', 'initiated');
      const { client, calls } = clientReturning(json({ data: verification }, 201));

      await expect(client.createVerification({ type: 'government-id' })).resolves.toEqual(
        verification,
      );
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications`,
        init: { method: 'POST' },
      });
      expect(jsonBody(calls[0])).toEqual({ type: 'government-id' });
    });
  });

  describe('uploadFile', () => {
    it('POSTs multipart form data with the kind before the file', async () => {
      const { client, calls } = clientReturning(
        json({ data: fileResource(VERIFICATION_ID, 'front') }, 201),
      );

      await expect(client.uploadFile(VERIFICATION_ID, 'front', pngFile())).resolves.toEqual(
        fileResource(VERIFICATION_ID, 'front'),
      );

      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${VERIFICATION_ID}/files`,
        init: { method: 'POST' },
      });
      const body = calls[0]?.init.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect([...form.keys()]).toEqual(['kind', 'file']);
      expect(form.get('kind')).toBe('front');
      // The browser sets the multipart boundary itself.
      expect(headers(calls[0]).has('content-type')).toBe(false);
    });

    it('never sends the user’s own file name, which can contain personal data', async () => {
      const { client, calls } = clientReturning(
        json({ data: fileResource(VERIFICATION_ID, 'front') }, 201),
      );

      await client.uploadFile(VERIFICATION_ID, 'front', pngFile('jane-sample-passport.png'));

      const file = (calls[0]?.init.body as FormData).get('file');
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe('front.png');
    });

    it('names a captured JPEG after its kind', async () => {
      const { client, calls } = clientReturning(
        json({ data: fileResource(VERIFICATION_IDS.selfie, 'selfie-center') }, 201),
      );

      await client.uploadFile(VERIFICATION_IDS.selfie, 'selfie-center', jpegBlob());

      expect(((calls[0]?.init.body as FormData).get('file') as File).name).toBe(
        'selfie-center.jpg',
      );
    });

    it('names a document after its kind and the type of its bytes, never the user’s own name (C52.4)', async () => {
      const id = PHASE5_VERIFICATION_IDS.document;
      const { client, calls } = clientReturning(json({ data: fileResource(id, 'document') }, 201));

      await expect(
        client.uploadFile(id, 'document', pdfFile('alex-example-bank-statement.pdf')),
      ).resolves.toEqual(fileResource(id, 'document'));

      const form = calls[0]?.init.body as FormData;
      expect(form.get('kind')).toBe('document');
      expect((form.get('file') as File).name).toBe('document.pdf');
      expect((form.get('file') as File).type).toBe('application/pdf');
    });

    it('rejects a malformed verification ID without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(client.uploadFile('../session', 'front', pngFile())).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });

  describe('createSelfieCapture (C40.2)', () => {
    it('POSTs the capture method and returns the capture with its nonce and prompts', async () => {
      const { client, calls } = clientReturning(json({ data: GOLDEN_SELFIE_CAPTURE }, 201));

      await expect(
        client.createSelfieCapture(VERIFICATION_IDS.selfie, { method: 'camera' }),
      ).resolves.toEqual(GOLDEN_SELFIE_CAPTURE);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${VERIFICATION_IDS.selfie}/selfies`,
        init: { method: 'POST' },
      });
      expect(jsonBody(calls[0])).toEqual({ method: 'camera' });
    });

    it('refuses a method outside the contract without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(
        client.createSelfieCapture(VERIFICATION_IDS.selfie, {
          method: 'video' as unknown as 'camera',
        }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it('rejects a capture answer that breaks the contract', async () => {
      const { client } = clientReturning(
        json(
          {
            data: {
              ...GOLDEN_SELFIE_CAPTURE,
              attributes: { ...GOLDEN_SELFIE_CAPTURE.attributes, prompts: ['left', 'center'] },
            },
          },
          201,
        ),
      );

      expect(
        (await caught(client.createSelfieCapture(VERIFICATION_IDS.selfie, { method: 'upload' })))
          .kind,
      ).toBe('invalid-response');
    });
  });

  describe('uploadFile with a selfie capture (C40.3)', () => {
    const capture = {
      captureId: GOLDEN_SELFIE_CAPTURE.id,
      nonce: GOLDEN_SELFIE_CAPTURE.attributes.nonce,
      clientElapsedMs: 4321,
    };

    it('sends the kind, the capture id, the nonce and the elapsed time, all before the file', async () => {
      const { client, calls } = clientReturning(
        json({ data: fileResource(VERIFICATION_IDS.selfie, 'selfie-left') }, 201),
      );

      await client.uploadFile(
        VERIFICATION_IDS.selfie,
        'selfie-left',
        jpegBlob(),
        undefined,
        capture,
      );

      const form = calls[0]?.init.body as FormData;
      expect([...form.keys()]).toEqual([
        'kind',
        'capture-id',
        'nonce',
        'client-elapsed-ms',
        'file',
      ]);
      expect(form.get('kind')).toBe('selfie-left');
      expect(form.get('capture-id')).toBe(GOLDEN_SELFIE_CAPTURE.id);
      expect(form.get('nonce')).toBe(GOLDEN_SELFIE_CAPTURE.attributes.nonce);
      expect(form.get('client-elapsed-ms')).toBe('4321');
    });

    it('refuses capture fields outside the contract without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(
        client.uploadFile(VERIFICATION_IDS.selfie, 'selfie-center', jpegBlob(), undefined, {
          ...capture,
          nonce: 'short',
        }),
      ).rejects.toThrow();
      await expect(
        client.uploadFile(VERIFICATION_IDS.selfie, 'selfie-center', jpegBlob(), undefined, {
          ...capture,
          clientElapsedMs: 600_001,
        }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });
  });

  describe('submitVerification with a selfie capture (C40.4)', () => {
    it('POSTs the capture, its nonce and the device snapshot as JSON', async () => {
      const verification = flowVerification('selfie', 'submitted');
      const { client, calls } = clientReturning(json({ data: verification }));

      await expect(
        client.submitVerification(VERIFICATION_IDS.selfie, undefined, GOLDEN_SELFIE_SUBMIT),
      ).resolves.toEqual(verification);
      expect(headers(calls[0]).get('content-type')).toBe('application/json');
      expect(jsonBody(calls[0])).toEqual(GOLDEN_SELFIE_SUBMIT);
    });

    it('refuses a device member outside the contract without calling the API', async () => {
      const { client, calls } = clientReturning();
      const body = {
        capture: {
          ...GOLDEN_SELFIE_SUBMIT.capture,
          device: { serial: 'not a member' },
        },
      } as unknown as typeof GOLDEN_SELFIE_SUBMIT;

      await expect(
        client.submitVerification(VERIFICATION_IDS.selfie, undefined, body),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });
  });

  describe('submitVerification', () => {
    it('POSTs without a body and returns the submitted verification', async () => {
      const verification = flowVerification('government_id', 'submitted');
      const { client, calls } = clientReturning(json({ data: verification }));

      await expect(client.submitVerification(VERIFICATION_ID)).resolves.toEqual(verification);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${VERIFICATION_ID}/submit`,
        init: { method: 'POST' },
      });
      expect(calls[0]?.init.body).toBeUndefined();
      expect(headers(calls[0]).has('content-type')).toBe(false);
    });
  });

  describe('getVerification', () => {
    it('GETs the verification with its retry hints', async () => {
      const verification = flowVerification('government_id', 'failed', {
        hints: [{ name: 'id_blur_detection', reasons: ['image_blurry'] }],
      });
      const { client, calls } = clientReturning(json({ data: verification }));

      await expect(client.getVerification(VERIFICATION_ID)).resolves.toEqual(verification);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${VERIFICATION_ID}`,
        init: { method: 'GET' },
      });
    });

    it('rejects an ID of another type without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(client.getVerification(INQUIRY_ID)).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    });
  });

  describe('sendOtp (C55)', () => {
    const PHONE_ID = PHASE5_VERIFICATION_IDS.phone_number;
    const sent = flowVerification('phone_number', 'initiated', {
      guidance: {
        'allowed-countries': ['GB', 'US'],
        'code-length': 6,
        otp: {
          'masked-destination': '+44 •••• ••• 123',
          'expires-at': '2026-10-20T12:10:00.000Z',
          'resend-available-at': '2026-10-20T12:00:30.000Z',
          'sends-remaining': 4,
          'attempts-remaining': 5,
        },
      },
    });

    it('POSTs the phone number as JSON and returns the verification with its open code', async () => {
      const { client, calls } = clientReturning(json({ data: sent }));

      await expect(client.sendOtp(PHONE_ID, { 'phone-number': '+447700900123' })).resolves.toEqual(
        sent,
      );
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${PHONE_ID}/otp`,
        init: { method: 'POST' },
      });
      expect(headers(calls[0]).get('content-type')).toBe('application/json');
      expect(jsonBody(calls[0])).toEqual({ 'phone-number': '+447700900123' });
    });

    it('POSTs an email address', async () => {
      const email = flowVerification('email_address', 'initiated');
      const { client, calls } = clientReturning(json({ data: email }));

      await client.sendOtp(PHASE5_VERIFICATION_IDS.email_address, {
        'email-address': 'user@example.test',
      });

      expect(jsonBody(calls[0])).toEqual({ 'email-address': 'user@example.test' });
    });

    it('refuses a body outside the contract without calling the API', async () => {
      const { client, calls } = clientReturning();
      const body = { 'phone-number': '+447700900123', 'email-address': 'a@b.test' };

      await expect(client.sendOtp(PHONE_ID, body as never)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it('keeps the wait of a resend asked for too soon (C52.7 otp_resend_too_soon)', async () => {
      const golden = GOLDEN_FLOW_PROBLEMS.get('otp_resend_too_soon');
      const { client } = clientReturning(json(golden, 429, 'application/problem+json'));

      const error = await caught(client.sendOtp(PHONE_ID, { 'phone-number': '+447700900123' }));

      expect(error).toMatchObject({ kind: 'http', status: 429 });
      expect(error.problem).toMatchObject({
        code: 'otp_resend_too_soon',
        'resend-available-at': '2026-10-20T12:01:00.000Z',
      });
    });

    it('rejects a malformed verification ID without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(client.sendOtp('ver_nope', { 'phone-number': '+447700900123' })).rejects.toThrow(
        TypeError,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('confirmOtp (C55)', () => {
    const PHONE_ID = PHASE5_VERIFICATION_IDS.phone_number;

    it('POSTs the code and returns the confirmed verification', async () => {
      const confirmed = flowVerification('phone_number', 'confirmed');
      const { client, calls } = clientReturning(json({ data: confirmed }));

      await expect(client.confirmOtp(PHONE_ID, { code: '123456' })).resolves.toEqual(confirmed);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${PHONE_ID}/otp/confirm`,
        init: { method: 'POST' },
      });
      expect(jsonBody(calls[0])).toEqual({ code: '123456' });
    });

    it.each(['12345', '12345678901', '12 345', 'abcdef'])(
      'refuses the code %j without calling the API',
      async (code) => {
        const { client, calls } = clientReturning();

        await expect(client.confirmOtp(PHONE_ID, { code })).rejects.toThrow();
        expect(calls).toHaveLength(0);
      },
    );

    it('keeps the attempts left after a wrong code (C52.7 otp_incorrect)', async () => {
      const golden = GOLDEN_FLOW_PROBLEMS.get('otp_incorrect');
      const { client } = clientReturning(json(golden, 422, 'application/problem+json'));

      const error = await caught(client.confirmOtp(PHONE_ID, { code: '000000' }));

      expect(error.problem).toMatchObject({ code: 'otp_incorrect', 'attempts-remaining': 4 });
    });
  });

  describe('enterInputs (C52.3)', () => {
    const DATABASE_ID = PHASE5_VERIFICATION_IDS.database;
    const VALUES = {
      'name-first': 'Alex',
      'name-last': 'Example',
      birthdate: '1990-01-31',
      'address-country-code': 'GB',
    };

    it('POSTs the values and returns the verification, which never echoes them', async () => {
      const received = flowVerification('database', 'initiated', { inputsReceived: true });
      const { client, calls } = clientReturning(json({ data: received }));

      await expect(client.enterInputs(DATABASE_ID, VALUES)).resolves.toEqual(received);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${DATABASE_ID}/inputs`,
        init: { method: 'POST' },
      });
      expect(jsonBody(calls[0])).toEqual(VALUES);
    });

    it('refuses a member no form type takes without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(
        client.enterInputs(DATABASE_ID, { ...VALUES, 'favourite-colour': 'blue' } as never),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it('keeps the JSON Pointer of each refused member', async () => {
      const { client } = clientReturning(
        json(
          {
            type: 'about:blank',
            title: 'Unprocessable Content',
            status: 422,
            detail: 'The values were refused.',
            instance: `/api/v1/flow/verifications/${DATABASE_ID}/inputs`,
            requestId: 'req-1',
            errors: [{ location: 'body', pointer: '/birthdate', detail: 'must be a date' }],
          },
          422,
          'application/problem+json',
        ),
      );

      const error = await caught(client.enterInputs(DATABASE_ID, VALUES));

      expect(error.problem?.errors).toEqual([
        { location: 'body', pointer: '/birthdate', detail: 'must be a date' },
      ]);
    });
  });

  describe('createCryptoChallenge (C57.2)', () => {
    const WALLET_ID = PHASE5_VERIFICATION_IDS.crypto_wallet;
    const CHALLENGE = {
      id: 'cwc_01M5CK5AAB0000000000000C01',
      message: 'flow.example.test wants you to sign in with your Ethereum account:\n0x0',
      'expires-at': '2026-10-20T12:10:00.000Z',
    };
    const BODY = {
      'chain-id': 'eip155:1',
      'wallet-address': '0x52908400098527886E0F7030069857D2E4169EE7',
    };

    it('POSTs the chain and the address and returns the message to sign', async () => {
      const { client, calls } = clientReturning(json(CHALLENGE, 201));

      await expect(client.createCryptoChallenge(WALLET_ID, BODY)).resolves.toEqual(CHALLENGE);
      expect(calls[0]).toMatchObject({
        url: `${BASE_URL}/api/v1/flow/verifications/${WALLET_ID}/crypto-challenges`,
        init: { method: 'POST' },
      });
      expect(jsonBody(calls[0])).toEqual(BODY);
    });

    it('refuses a chain id that is not canonical CAIP-2 without calling the API', async () => {
      const { client, calls } = clientReturning();

      await expect(
        client.createCryptoChallenge(WALLET_ID, { ...BODY, 'chain-id': 'ethereum' }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it('reports a challenge answer that breaks the contract', async () => {
      const { client } = clientReturning(json({ ...CHALLENGE, id: 'not-a-challenge' }, 201));

      const error = await caught(client.createCryptoChallenge(WALLET_ID, BODY));

      expect(error.kind).toBe('invalid-response');
    });
  });

  describe('submitVerification with a wallet signature (C57.3)', () => {
    it('POSTs the challenge and its signature as the crypto member', async () => {
      const verification = flowVerification('crypto_wallet', 'submitted');
      const { client, calls } = clientReturning(json({ data: verification }));
      const body = {
        crypto: {
          'challenge-id': 'cwc_01M5CK5AAB0000000000000C01',
          signature: `0x${'ab'.repeat(65)}`,
          scheme: 'eip191' as const,
        },
      };

      await client.submitVerification(PHASE5_VERIFICATION_IDS.crypto_wallet, undefined, body);

      expect(jsonBody(calls[0])).toEqual(body);
    });
  });

  describe('errors', () => {
    it('turns problem+json responses into http errors carrying the problem', async () => {
      const { client } = clientReturning(problem(409, 'Conflict'));

      const error = await caught(client.getSession());

      expect(error).toMatchObject({ kind: 'http', status: 409 });
      expect(error.problem).toMatchObject({ title: 'Conflict', requestId: 'req-1' });
      expect(error.message).toBe('GET /api/v1/flow/session failed with HTTP 409');
    });

    it('keeps the status when the error body is not a problem document', async () => {
      const { client } = clientReturning(
        new Response('<h1>Bad gateway</h1>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      );

      const error = await caught(client.getSession());

      expect(error).toMatchObject({ kind: 'http', status: 502, problem: null });
    });

    it('ignores a JSON error body that is not a valid problem', async () => {
      const { client } = clientReturning(json({ message: 'nope' }, 500));

      await expect(caught(client.getSession())).resolves.toMatchObject({
        kind: 'http',
        status: 500,
        problem: null,
      });
    });

    it('ignores an error body that claims JSON but is not', async () => {
      const { client } = clientReturning(
        new Response('{', { status: 503, headers: { 'content-type': 'application/problem+json' } }),
      );

      await expect(caught(client.getSession())).resolves.toMatchObject({
        kind: 'http',
        status: 503,
        problem: null,
      });
    });

    it('reports a response that breaks the contract', async () => {
      const { client } = clientReturning(json({ inquiry: { id: INQUIRY_ID } }));

      await expect(caught(client.getSession())).resolves.toMatchObject({
        kind: 'invalid-response',
        status: 200,
      });
    });

    it('reports a successful response that is not JSON', async () => {
      const { client } = clientReturning(new Response('ok', { status: 200 }));

      await expect(caught(client.getSession())).resolves.toMatchObject({
        kind: 'invalid-response',
      });
    });

    it('rejects retry hints that name a fraud check', async () => {
      const verification = {
        ...flowVerification('government_id', 'failed'),
        attributes: {
          ...flowVerification('government_id', 'failed').attributes,
          'retry-hints': [{ name: 'id_portrait_detection', reasons: ['portrait_not_present'] }],
        },
      };
      const { client } = clientReturning(json({ data: verification }));

      await expect(caught(client.getVerification(VERIFICATION_ID))).resolves.toMatchObject({
        kind: 'invalid-response',
      });
    });

    it('reports network failures', async () => {
      const cause = new TypeError('Failed to fetch');
      const { client } = clientReturning(cause);

      const error = await caught(client.getSession());

      expect(error).toMatchObject({ kind: 'network', status: null, cause });
    });

    it('reports aborted requests', async () => {
      const controller = new AbortController();
      controller.abort();
      const { client } = clientReturning(
        new DOMException('The operation was aborted.', 'AbortError'),
      );

      await expect(caught(client.getSession(controller.signal))).resolves.toMatchObject({
        kind: 'aborted',
      });
    });

    it('never puts the token in an error', async () => {
      const { client } = clientReturning(problem(401, 'Unauthorized'));

      const error = await caught(client.getSession());

      expect(error.message).not.toContain(SESSION_TOKEN);
      expect(JSON.stringify(error)).not.toContain(SESSION_TOKEN);
      expect(String(error.stack)).not.toContain(SESSION_TOKEN);
    });

    it('keeps the code of an inactive session’s 401 (C10)', async () => {
      const { client } = clientReturning(
        json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'The session has expired.',
            instance: '/api/v1/flow/session',
            requestId: 'req-1',
            code: 'session_expired',
          },
          401,
          'application/problem+json',
        ),
      );

      const error = await caught(client.getSession());

      expect(error).toMatchObject({ kind: 'http', status: 401 });
      expect(error.problem?.code).toBe('session_expired');
    });

    it.each([...GOLDEN_PROBLEMS])(
      'keeps the code and reason of the golden canceled-session problem %s (C25.8)',
      async (_name, body) => {
        const { client } = clientReturning(json(body, 401, 'application/problem+json'));

        const error = await caught(client.getSession());

        expect(error).toMatchObject({ kind: 'http', status: 401 });
        expect(error.problem).toEqual(body);
      },
    );

    it('keeps the code of a canceled session whose reason this version does not know (C25.8)', async () => {
      const { client } = clientReturning(
        json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'The session was canceled.',
            instance: '/api/v1/flow/session',
            requestId: 'req-1',
            code: 'session_canceled',
            reason: 'inquiry_archived_by_a_newer_server',
          },
          401,
          'application/problem+json',
        ),
      );

      const error = await caught(client.getSession());

      expect(error).toMatchObject({ kind: 'http', status: 401 });
      expect(error.problem).toMatchObject({ code: 'session_canceled', requestId: 'req-1' });
      expect(error.problem).not.toHaveProperty('reason');
    });
  });

  describe('timeouts (1B F018)', () => {
    /** A server that never answers: the request settles only when its signal aborts. */
    function hangingClient(timeouts?: { requestMs?: number; uploadMs?: number }) {
      const signals: AbortSignal[] = [];
      const fetchStub = vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) => {
        const { signal } = init;
        if (signal) {
          signals.push(signal);
        }
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
            { once: true },
          );
        });
      });
      const client = createFlowApiClient({
        baseUrl: BASE_URL,
        sessionToken: SESSION_TOKEN,
        fetch: fetchStub,
        ...(timeouts === undefined ? {} : { timeouts }),
      });
      return { client, signals };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('gives up on a request after 30 seconds by default, as a timeout error', async () => {
      vi.useFakeTimers();
      const { client, signals } = hangingClient();
      const result = caught(client.getSession());

      await vi.advanceTimersByTimeAsync(29_999);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const error = await result;
      expect(error).toMatchObject({ kind: 'timeout', status: null });
      expect(error.message).toBe('GET /api/v1/flow/session timed out');
      expect(signals[0]?.aborted).toBe(true);
    });

    it('gives uploads longer: 120 seconds by default', async () => {
      vi.useFakeTimers();
      const { client } = hangingClient();
      let settled = false;
      const result = caught(client.uploadFile(VERIFICATION_ID, 'front', pngFile())).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(119_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toMatchObject({ kind: 'timeout' });
    });

    it('takes its timeouts from the options', async () => {
      vi.useFakeTimers();
      const { client } = hangingClient({ requestMs: 50 });
      const result = caught(
        client.acceptConsent({ accepted: true, 'text-keys': ['consent.biometric'], locale: 'en' }),
      );

      await vi.advanceTimersByTimeAsync(50);

      await expect(result).resolves.toMatchObject({ kind: 'timeout' });
    });

    it('also times out a response whose body never finishes', async () => {
      vi.useFakeTimers();
      const stalled = new Response(new ReadableStream({ start: () => undefined }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const { client } = clientReturningWithTimeouts({ requestMs: 100 }, stalled);
      const result = caught(client.getSession());

      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toMatchObject({ kind: 'timeout' });
    });

    it('also times out an error answer whose body never finishes', async () => {
      vi.useFakeTimers();
      const stalled = new Response(new ReadableStream({ start: () => undefined }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json' },
      });
      const { client } = clientReturningWithTimeouts({ requestMs: 100 }, stalled);
      const result = caught(client.getSession());

      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toMatchObject({ kind: 'timeout' });
    });

    it('reports the caller’s abort as aborted, not as a timeout', async () => {
      vi.useFakeTimers();
      const { client } = hangingClient();
      const controller = new AbortController();
      const result = caught(client.getSession(controller.signal));

      controller.abort();

      await expect(result).resolves.toMatchObject({ kind: 'aborted' });
    });

    it('stops its timer once the answer has arrived', async () => {
      vi.useFakeTimers();
      const { client, calls } = clientReturning(json(flowSession()));

      await client.getSession();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(calls[0]?.init.signal?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

function clientReturningWithTimeouts(
  timeouts: { requestMs?: number; uploadMs?: number },
  response: Response,
): { client: FlowApiClient } {
  return {
    client: createFlowApiClient({
      baseUrl: BASE_URL,
      sessionToken: SESSION_TOKEN,
      fetch: () => Promise.resolve(response),
      timeouts,
    }),
  };
}
