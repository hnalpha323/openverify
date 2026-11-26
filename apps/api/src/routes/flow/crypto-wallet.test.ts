/**
 * C57.2, C52.2: `POST /api/v1/flow/verifications/:id/crypto-challenges` and the crypto wallet
 * step's guidance. The server builds the message for the claimed address on an offered chain
 * (EIP-4361 for EVM, Sign-In with Solana, the CAIP-122 wording for Bitcoin and TRON) with its
 * domain and URI from `OPENVERIFY_FLOW_PUBLIC_URL`, stores it sealed, supersedes the open
 * challenge, and cancels the verification at the 11th. Every address is synthetic or a published
 * test vector.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  CRYPTO_CHALLENGE_LIMIT,
  CRYPTO_CHALLENGE_TTL_SECONDS,
  flowCryptoChallengeResponseSchema,
  flowVerificationDocumentSchema,
} from '@openverify/contracts';
import {
  cryptoAddressIndex,
  getInquiry,
  getVerification,
  listCryptoChallenges,
  openCryptoChallengeEvidence,
} from '@openverify/db';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processVerification } from '../../jobs/process-verification.js';
import { createCapturingLogger, createFakeVision } from '../../jobs/testing.js';
import {
  cryptoWalletTemplateAttributes,
  signTestPersonalMessage,
  testSolanaWallet,
  testWalletAddress,
  TEST_CHAINS,
  type CryptoWalletTemplateOptions,
} from '../../services/crypto-challenges/testing.js';
import { T0 } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  api = await createTestApi();
  templateId = await template();
});

beforeEach(() => {
  api.clock.set(T0);
});

afterAll(async () => {
  await api.close();
});

/** EIP-55's first published example address. */
const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
/** BIP-173's first published P2WPKH example address. */
const BITCOIN_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
/** TRON's zero account, as its documentation publishes it. */
const TRON_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const STATEMENT =
  'Example Test Org asks you to prove you control this wallet. Signing is free and moves no funds.';
const ISSUED = '2026-10-20T12:00:00.000Z';
const EXPIRES = '2026-10-20T12:10:00.000Z';

async function template(options: CryptoWalletTemplateOptions = {}): Promise<string> {
  return createTemplate(api, api.token, cryptoWalletTemplateAttributes(options));
}

const CONSENT = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/** A started inquiry of `templateId` whose session consented, with a crypto wallet verification. */
async function walletFlow(
  options: { templateId?: string; fields?: Record<string, string>; consent?: boolean } = {},
) {
  const inquiryId = await createInquiry(api, {
    templateId: options.templateId ?? templateId,
    ...(options.fields === undefined ? {} : { fields: options.fields }),
  });
  const token = await resumeInquiry(api, inquiryId);
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
  if (options.consent !== false) {
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: CONSENT,
      }),
      201,
    );
  }
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'crypto_wallet',
  });
  return { inquiryId, token, verificationId: id };
}

function challenge(
  flow: { token: string; verificationId: string },
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${flow.verificationId}/crypto-challenges`,
    headers: { ...bearer(flow.token), ...headers },
    payload: body,
  });
}

function issued(response: LightMyRequestResponse) {
  if (response.statusCode !== 201) {
    throw new Error(`expected HTTP 201, got ${String(response.statusCode)}: ${response.body}`);
  }
  return flowCryptoChallengeResponseSchema.parse(response.json());
}

const nonceOf = (message: string) => /\nNonce: ([0-9A-Za-z]+)\n/u.exec(message)?.[1] ?? '';

/** The golden problem of `code`, `instance` and `requestId` aside. */
function expectGolden(response: LightMyRequestResponse, code: string): void {
  const url = new URL(
    `../../../../../contracts/fixtures/problems/flow/${code.replaceAll('_', '-')}.json`,
    import.meta.url,
  );
  const fixture = existsSync(url)
    ? (JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>)
    : undefined;
  const named = { instance: '<instance>', requestId: '<request id>' };
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  expect({ ...response.json<Record<string, unknown>>(), ...named }).toEqual(
    fixture === undefined ? undefined : { ...fixture, ...named },
  );
}

describe('the challenge message (C57.2)', () => {
  it('is EIP-4361 for an EVM chain: the flow host, the EIP-55 address, our statement, the nonce, ten minutes and the verification id', async () => {
    const flow = await walletFlow();

    const answer = issued(
      await challenge(flow, { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED }),
    );

    const nonce = nonceOf(answer.message);
    expect(nonce).toMatch(/^[0-9A-Za-z]{16}$/u);
    expect(answer.message).toBe(
      [
        'flow.example.test wants you to sign in with your Ethereum account:',
        CHECKSUMMED,
        '',
        STATEMENT,
        '',
        'URI: https://flow.example.test/',
        'Version: 1',
        'Chain ID: 1',
        `Nonce: ${nonce}`,
        `Issued At: ${ISSUED}`,
        `Expiration Time: ${EXPIRES}`,
        `Request ID: ${flow.verificationId}`,
      ].join('\n'),
    );
    expect(answer.id).toMatch(/^cwc_/u);
    expect(answer['expires-at']).toBe(EXPIRES);
    expect(CRYPTO_CHALLENGE_TTL_SECONDS).toBe(600);
  });

  it('writes a lower-case EVM address in its EIP-55 form, and names the chain id', async () => {
    const flow = await walletFlow();

    const answer = issued(
      await challenge(flow, {
        'chain-id': TEST_CHAINS.base,
        'wallet-address': CHECKSUMMED.toLowerCase(),
      }),
    );

    expect(answer.message.split('\n').slice(0, 2)).toEqual([
      'flow.example.test wants you to sign in with your Ethereum account:',
      CHECKSUMMED,
    ]);
    expect(answer.message).toContain('\nChain ID: 8453\n');
  });

  it('is Sign-In with Solana for Solana, with Chain ID mainnet', async () => {
    const flow = await walletFlow();
    const { address } = testSolanaWallet('flow/solana');

    const answer = issued(
      await challenge(flow, { 'chain-id': TEST_CHAINS.solana, 'wallet-address': address }),
    );

    expect(answer.message.split('\n')).toEqual([
      'flow.example.test wants you to sign in with your Solana account:',
      address,
      '',
      STATEMENT,
      '',
      'URI: https://flow.example.test/',
      'Version: 1',
      'Chain ID: mainnet',
      `Nonce: ${nonceOf(answer.message)}`,
      `Issued At: ${ISSUED}`,
      `Expiration Time: ${EXPIRES}`,
      `Request ID: ${flow.verificationId}`,
    ]);
  });

  it.each([
    [TEST_CHAINS.bitcoin, BITCOIN_ADDRESS, 'Bitcoin'],
    [TEST_CHAINS.tron, TRON_ADDRESS, 'TRON'],
  ])('is the CAIP-122 wording on %s, with the full chain id', async (chainId, address, kind) => {
    const flow = await walletFlow();

    const answer = issued(
      await challenge(flow, { 'chain-id': chainId, 'wallet-address': address }),
    );

    expect(answer.message.split('\n').slice(0, 2)).toEqual([
      `flow.example.test wants you to sign in with your ${kind} account:`,
      address,
    ]);
    expect(answer.message).toContain(`\nChain ID: ${chainId}\n`);
  });

  it('takes its domain and URI from OPENVERIFY_FLOW_PUBLIC_URL, never from Host or Origin', async () => {
    const flow = await walletFlow();

    const answer = issued(
      await challenge(
        flow,
        { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED },
        { host: 'attacker.example', origin: 'https://attacker.example' },
      ),
    );

    expect(answer.message).not.toContain('attacker');
    expect(answer.message.startsWith('flow.example.test wants you')).toBe(true);
  });
});

describe('the stored challenge (C57.2, C53.2)', () => {
  it('is initiated, with the claimed address and the message sealed and the canonical address indexed', async () => {
    const flow = await walletFlow();

    const answer = issued(
      await challenge(flow, { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED }),
    );

    const [stored, ...others] = await listCryptoChallenges(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    expect(others).toEqual([]);
    expect(stored).toMatchObject({
      id: answer.id,
      chainId: TEST_CHAINS.ethereum,
      status: 'initiated',
      inquiryId: flow.inquiryId,
      expiresAt: new Date(EXPIRES),
      addressIndex: cryptoAddressIndex(api.deps.blindIndexKey, {
        environmentId: api.environmentId,
        address: CHECKSUMMED.toLowerCase(),
      }),
    });
    expect(
      await openCryptoChallengeEvidence(api.database.db, api.environmentId, answer.id),
    ).toEqual({
      walletAddress: CHECKSUMMED,
      message: answer.message,
      signature: null,
      signedMessage: null,
    });
  });

  it('supersedes the open challenge with a new nonce, or marks it expired once past its expiry', async () => {
    const flow = await walletFlow();
    const body = { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED };

    const first = issued(await challenge(flow, body));
    const second = issued(await challenge(flow, body));
    api.clock.advance(CRYPTO_CHALLENGE_TTL_SECONDS * 1000);
    const third = issued(await challenge(flow, body));

    expect(nonceOf(second.message)).not.toBe(nonceOf(first.message));
    expect(
      (await listCryptoChallenges(api.database.db, api.environmentId, flow.verificationId)).map(
        (stored) => [stored.id, stored.status],
      ),
    ).toEqual([
      [third.id, 'initiated'],
      [second.id, 'expired'],
      [first.id, 'superseded'],
    ]);
    expect(third['expires-at']).toBe('2026-10-20T12:20:00.000Z');
  });
});

describe('refused challenges (C57.2)', () => {
  it('refuses a chain the step does not offer (422 crypto_chain_not_offered), storing nothing', async () => {
    const narrow = await template({ chains: [TEST_CHAINS.bitcoin] });
    const flow = await walletFlow({ templateId: narrow });

    const response = await challenge(flow, {
      'chain-id': TEST_CHAINS.ethereum,
      'wallet-address': CHECKSUMMED,
    });

    expect(response.statusCode).toBe(422);
    expectGolden(response, 'crypto_chain_not_offered');
    expect(
      await listCryptoChallenges(api.database.db, api.environmentId, flow.verificationId),
    ).toEqual([]);
  });

  it.each([
    ['not an address of the chain', TEST_CHAINS.ethereum, BITCOIN_ADDRESS],
    ['a broken EIP-55 checksum', TEST_CHAINS.ethereum, CHECKSUMMED.replace('a', 'A')],
    ['a Bitcoin address with a typo', TEST_CHAINS.bitcoin, BITCOIN_ADDRESS.replace('q', 'p')],
    ['an address with spaces', TEST_CHAINS.ethereum, ` ${CHECKSUMMED}`],
  ])('refuses %s (422 crypto_address_invalid)', async (_name, chainId, address) => {
    const flow = await walletFlow();

    const response = await challenge(flow, { 'chain-id': chainId, 'wallet-address': address });

    expect(response.statusCode).toBe(422);
    expectGolden(response, 'crypto_address_invalid');
  });

  it('refuses an EVM address without its checksum only while require-evm-checksum is set', async () => {
    const strict = await template({
      config: (config) => ({
        ...config,
        checks: {
          ...config.checks,
          crypto_wallet_validity_detection: {
            enabled: true,
            required: true,
            config: { 'require-evm-checksum': true },
          },
        },
      }),
    });
    const lower = { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED.toLowerCase() };

    const refused = await challenge(await walletFlow({ templateId: strict }), lower);
    const checksummed = await challenge(await walletFlow({ templateId: strict }), {
      ...lower,
      'wallet-address': CHECKSUMMED,
    });
    const lenient = await challenge(await walletFlow(), lower);

    expect(refused.statusCode).toBe(422);
    expectGolden(refused, 'crypto_address_invalid');
    expect(checksummed.statusCode).toBe(201);
    expect(lenient.statusCode).toBe(201);
  });

  it('refuses an address other than the inquiry’s crypto_wallet_address (422 crypto_expected_address_mismatch)', async () => {
    const flow = await walletFlow({
      fields: { crypto_wallet_address: testWalletAddress('other') },
    });

    const response = await challenge(flow, {
      'chain-id': TEST_CHAINS.ethereum,
      'wallet-address': CHECKSUMMED,
    });

    expect(response.statusCode).toBe(422);
    expectGolden(response, 'crypto_expected_address_mismatch');
  });

  it('accepts the expected address once canonicalised: EVM in any case, bech32 lower-cased', async () => {
    const evm = await walletFlow({ fields: { crypto_wallet_address: CHECKSUMMED.toLowerCase() } });
    const bitcoin = await walletFlow({
      fields: { crypto_wallet_address: BITCOIN_ADDRESS.toUpperCase() },
    });

    expect(
      (await challenge(evm, { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await challenge(bitcoin, {
          'chain-id': TEST_CHAINS.bitcoin,
          'wallet-address': BITCOIN_ADDRESS,
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses an expected address of another chain as a mismatch', async () => {
    const flow = await walletFlow({ fields: { crypto_wallet_address: BITCOIN_ADDRESS } });

    const response = await challenge(flow, {
      'chain-id': TEST_CHAINS.ethereum,
      'wallet-address': CHECKSUMMED,
    });

    expectGolden(response, 'crypto_expected_address_mismatch');
  });

  it('refuses another verification type (422) and a verification no longer initiated (409)', async () => {
    const flow = await walletFlow();
    const other = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'phone_number',
    });
    const submitted = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'crypto_wallet',
      status: 'submitted',
    });
    const body = { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED };

    expect((await challenge({ ...flow, verificationId: other.id }, body)).statusCode).toBe(422);
    expect((await challenge({ ...flow, verificationId: submitted.id }, body)).statusCode).toBe(409);
  });
});

describe('the challenge cap (C57.2)', () => {
  const BODY = { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': CHECKSUMMED };

  it('cancels the verification at the 11th challenge (409 crypto_challenge_invalid), with attempts left', async () => {
    const flow = await walletFlow();
    for (let index = 0; index < CRYPTO_CHALLENGE_LIMIT; index += 1) {
      issued(await challenge(flow, BODY));
    }
    const before = api.events.events.length;

    const response = await challenge(flow, BODY);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, code: 'crypto_challenge_invalid' });
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('canceled');
    const stored = await listCryptoChallenges(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    expect(stored).toHaveLength(CRYPTO_CHALLENGE_LIMIT);
    expect(stored.filter((one) => one.status === 'initiated')).toEqual([]);
    expect(api.events.events.slice(before).map((event) => event.name)).toEqual([
      'verification.canceled',
    ]);
    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'pending',
    );
  });

  it('fails the inquiry when the canceled attempt was the step’s last', async () => {
    const single = await template({ maxAttempts: 1 });
    const flow = await walletFlow({ templateId: single });
    for (let index = 0; index < CRYPTO_CHALLENGE_LIMIT; index += 1) {
      issued(await challenge(flow, BODY));
    }
    const before = api.events.events.length;

    expect((await challenge(flow, BODY)).statusCode).toBe(409);

    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'failed',
    );
    expect(api.events.events.slice(before).map((event) => event.name)).toEqual(
      expect.arrayContaining(['verification.canceled', 'inquiry.failed']),
    );
  });
});

describe('the crypto wallet guidance (C52.2)', () => {
  it('names the offered chains and the signing methods', async () => {
    const flow = await walletFlow();

    const document = flowVerificationDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `/api/v1/flow/verifications/${flow.verificationId}`,
          headers: bearer(flow.token),
        }),
        200,
      ),
    );

    expect(document.data.attributes).toMatchObject({
      guidance: { chains: Object.values(TEST_CHAINS), signing: ['wallet', 'paste'] },
    });
  });

  it('keeps only the chains the type’s allowed-chains allows', async () => {
    const allowed = await template({
      chains: [TEST_CHAINS.ethereum, TEST_CHAINS.solana],
      signing: ['paste'],
      config: (config) => ({
        ...config,
        'allowed-chains': [TEST_CHAINS.solana, TEST_CHAINS.ethereum],
      }),
    });
    const flow = await walletFlow({ templateId: allowed });

    const document = flowVerificationDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `/api/v1/flow/verifications/${flow.verificationId}`,
          headers: bearer(flow.token),
        }),
        200,
      ),
    );

    expect(document.data.attributes).toMatchObject({
      guidance: { chains: [TEST_CHAINS.ethereum, TEST_CHAINS.solana], signing: ['paste'] },
    });
  });
});

describe('a crypto wallet verification end to end (C57, C54.1)', () => {
  it('is created by the flow, challenged, signed, submitted and judged passed by the job', async () => {
    const inquiryId = await createInquiry(api, { templateId });
    const token = await resumeInquiry(api, inquiryId);
    expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }),
      200,
    );
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: CONSENT,
      }),
      201,
    );
    const created = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/verifications',
        headers: bearer(token),
        payload: { type: 'crypto-wallet' },
      }),
      201,
    );
    expect(created.data.attributes).toMatchObject({
      status: 'initiated',
      guidance: { chains: Object.values(TEST_CHAINS), signing: ['wallet', 'paste'] },
    });
    const flow = { token, verificationId: created.data.id };
    const address = testWalletAddress('flow/end-to-end');
    const answer = issued(
      await challenge(flow, { 'chain-id': TEST_CHAINS.ethereum, 'wallet-address': address }),
    );

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/flow/verifications/${flow.verificationId}/submit`,
        headers: bearer(token),
        payload: {
          crypto: {
            'challenge-id': answer.id,
            signature: signTestPersonalMessage(answer.message, 'flow/end-to-end'),
            scheme: 'eip191',
          },
        },
      }),
      202,
    );
    const result = await processVerification(
      { environmentId: api.environmentId, verificationId: flow.verificationId },
      {
        db: api.database.db,
        storage: api.storage,
        keyring: api.database.keyring,
        vision: createFakeVision().client,
        events: api.events,
        clock: api.clock,
        logger: createCapturingLogger(),
      },
    );

    expect(result).toMatchObject({ outcome: 'processed', verificationStatus: 'passed' });
    const polled = expectStatus(
      await api.app.inject({
        url: `/api/v1/flow/verifications/${flow.verificationId}`,
        headers: bearer(token),
      }),
      200,
    );
    expect(polled.data.attributes).toMatchObject({ status: 'passed' });
    expect(polled.data.attributes).not.toHaveProperty('wallet-address');
    const served = expectStatus(
      await api.app.inject({
        url: `/api/v1/verifications/${flow.verificationId}`,
        headers: bearer(api.token),
      }),
      200,
    );
    expect(served.data.attributes).toMatchObject({
      'wallet-address': address,
      'chain-id': TEST_CHAINS.ethereum,
      'signature-scheme': 'eip191',
    });
  });
});
