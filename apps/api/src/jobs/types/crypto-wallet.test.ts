/**
 * C57.4, C54.1: the crypto wallet job. It reads the verification's submitted challenge (the
 * message we issued, the claimed address, the signature and any signed bytes) and the inquiry's
 * expected address, asks the `evmRpc` provider (`eth_getCode`, then ERC-1271) only when an EVM
 * signature recovers no matching key, evaluates the four checks, and in the decision transaction
 * marks the challenge `processed` with the scheme it established. Gaps on our side (no RPC, a
 * failed RPC, a contract wallet the template does not allow) go to review, never to a fraud
 * failure. Every key is a labelled test wallet; every value is synthetic.
 */
import { buildCryptoChallengeMessage } from '@openverify/checks';
import { newId, type CreateInquiryTemplateAttributes } from '@openverify/contracts';
import { checkResultSchema, type VerificationTemplateConfig } from '@openverify/core';
import {
  consumeCryptoChallenge,
  createCryptoChallenge,
  createVerification,
  getCryptoChallenge,
  getVerification,
  listEvents,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import type { EvmRpcProvider, ProviderBindings } from '../../ports.js';
import { ProviderError } from '../../providers/errors.js';
import { createEvmRpcProvider } from '../../providers/evm-rpc/index.js';
import {
  SANDBOX_CONTRACT_WALLET,
  SANDBOX_CONTRACT_WALLET_OWNER_LABEL,
} from '../../providers/evm-rpc/sandbox.js';
import {
  cryptoWalletTemplateAttributes,
  signTestPersonalMessage,
  testSolanaWallet,
  testWalletAddress,
  TEST_CHAINS,
} from '../../services/crypto-challenges/testing.js';
import { createRecordingQueue as createRecordingVerificationQueue } from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../../webhooks/queue.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from '../process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
} from '../testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(0x5b);
const ALICE = 'job/alice';

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  environmentId = (await createTestTenant(db, { organizationName: 'Wallet Test Org' })).environment
    .id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

interface Submission {
  chainId?: string;
  address: string;
  /** Signs the challenge message; returns the submitted signature. */
  sign(message: string): string;
  scheme?: string | null;
  signedMessage?: string | null;
  fields?: Record<string, unknown>;
  template?: CreateInquiryTemplateAttributes;
}

/** A pending inquiry with a submitted crypto wallet verification and its consumed challenge. */
async function submitted(submission: Submission) {
  const attributes = submission.template ?? cryptoWalletTemplateAttributes();
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow: attributes.flow,
    verificationConfig: attributes['verification-config'],
    fields: submission.fields ?? {},
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  const verificationId = newId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'crypto_wallet',
  });
  const chainId = submission.chainId ?? TEST_CHAINS.ethereum;
  const expiresAt = new Date(NOW.getTime() + 600_000);
  const message = buildCryptoChallengeMessage({
    chainId,
    address: submission.address,
    origin: 'https://flow.example.test',
    organizationName: 'Wallet Test Org',
    nonce: 'a1B2c3D4e5F6g7H8',
    issuedAt: NOW,
    expiresAt,
    requestId: verificationId,
  });
  const challenge = await createCryptoChallenge(db, environmentId, {
    id: newId('cwc'),
    verificationId,
    inquiryId: inquiry.id,
    chainId,
    walletAddress: submission.address,
    message,
    blindIndexKey: KEY,
    createdAt: NOW,
    expiresAt,
  });
  await consumeCryptoChallenge(db, environmentId, {
    id: challenge.id,
    verificationId,
    now: NOW,
    submission: {
      signature: submission.sign(message),
      signedMessage: submission.signedMessage ?? null,
      scheme: submission.scheme ?? null,
    },
  });
  await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });
  return { inquiryId: inquiry.id, verificationId, challengeId: challenge.id, message };
}

function setup(options: { evmRpc?: EvmRpcProvider } = {}) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    logger,
  });
  const providers: ProviderBindings = {
    sandbox: options.evmRpc === undefined ? {} : { evmRpc: options.evmRpc },
    production: {},
  };
  const deps: ProcessVerificationDeps = {
    db,
    storage: createMemoryStorage(),
    keyring,
    vision: createFakeVision().client,
    events,
    clock: { now: () => NOW },
    logger,
    providers,
    queue: createRecordingVerificationQueue(),
  };
  return { deps, logger };
}

/** A recording `evmRpc` provider over `inner`, or failing with `error`. */
function recordingRpc(inner: EvmRpcProvider | Error) {
  const calls: string[] = [];
  const rpc: EvmRpcProvider = {
    id: 'json-rpc',
    sandbox: false,
    getCode: (chainId, address) => {
      calls.push(`getCode ${chainId} ${address}`);
      return inner instanceof Error ? Promise.reject(inner) : inner.getCode(chainId, address);
    },
    call: (chainId, request) => {
      calls.push(`call ${chainId} ${request.to} gas ${String(request.gas)}`);
      return inner instanceof Error ? Promise.reject(inner) : inner.call(chainId, request);
    },
  };
  return { rpc, calls };
}

const sandboxRpc = () => createEvmRpcProvider('sandbox');

async function judge(
  target: { verificationId: string },
  options: { evmRpc?: EvmRpcProvider; lastAttempt?: boolean } = {},
) {
  const { deps, logger } = setup(options);
  const result = await processVerification(
    { environmentId, verificationId: target.verificationId },
    deps,
    { lastAttempt: options.lastAttempt === true },
  );
  const verification = await getVerification(db, environmentId, target.verificationId);
  const check = (name: string) => verification?.checks.find((one) => one.name === name);
  return { result, verification, check, logger };
}

const alice = (overrides: Partial<Submission> = {}): Submission => ({
  address: testWalletAddress(ALICE),
  sign: (message) => signTestPersonalMessage(message, ALICE),
  ...overrides,
});

const withContractWallets = (allow: boolean) =>
  cryptoWalletTemplateAttributes({
    config: (config: VerificationTemplateConfig) => ({
      ...config,
      checks: {
        ...config.checks,
        crypto_wallet_address_comparison: {
          enabled: true,
          required: true,
          config: { 'allow-contract-wallets': allow },
        },
      },
    }),
  });

describe('the crypto wallet job (C57.4)', () => {
  it('passes a genuine EVM signature over our challenge, asking no RPC', async () => {
    const target = await submitted(alice());
    const { rpc, calls } = recordingRpc(sandboxRpc());

    const { result, verification, check } = await judge(target, { evmRpc: rpc });

    expect(result).toMatchObject({ outcome: 'processed', verificationStatus: 'passed' });
    expect(verification?.status).toBe('passed');
    expect(check('crypto_wallet_validity_detection')).toMatchObject({
      status: 'passed',
      metadata: { checksum: 'absent' },
    });
    expect(check('crypto_wallet_disallowed_chain_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_allowlist'],
    });
    expect(check('crypto_wallet_statement_comparison')).toMatchObject({ status: 'passed' });
    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'passed',
      metadata: { scheme: 'eip191', 'high-s': false },
    });
    expect(calls).toEqual([]);
  });

  it('marks the challenge processed with the scheme it established, in the decision transaction', async () => {
    const target = await submitted(alice());

    await judge(target);

    expect(await getCryptoChallenge(db, environmentId, target.challengeId)).toMatchObject({
      status: 'processed',
      scheme: 'eip191',
    });
    const page = await listEvents(db, environmentId, { size: 100 });
    const passed = page.items.find(
      (event) =>
        event.name === 'verification.passed' &&
        (event.payload as { data: { id: string } }).data.id === target.verificationId,
    );
    expect((passed?.payload as { data: { attributes: unknown } }).data.attributes).toMatchObject({
      'wallet-address': testWalletAddress(ALICE),
      'chain-id': TEST_CHAINS.ethereum,
      'signature-scheme': 'eip191',
    });
  });

  it('sends another key’s EVM signature to review without an RPC (provider_not_configured)', async () => {
    const target = await submitted(
      alice({ sign: (message) => signTestPersonalMessage(message, 'job/mallory') }),
    );

    const { verification, check } = await judge(target);

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
    expect(verification?.status).toBe('needs_review');
  });

  it('fails another key’s EVM signature once the RPC says the address holds no code (signature_address_mismatch)', async () => {
    const target = await submitted(
      alice({ sign: (message) => signTestPersonalMessage(message, 'job/mallory') }),
    );
    const { rpc, calls } = recordingRpc(sandboxRpc());

    const { verification, check } = await judge(target, { evmRpc: rpc });

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'failed',
      type: 'user_behavior',
      reasons: ['signature_address_mismatch'],
    });
    expect(verification?.status).toBe('failed');
    expect(calls).toEqual([`getCode ${TEST_CHAINS.ethereum} ${testWalletAddress(ALICE)}`]);
  });

  it('asks ERC-1271 once for a contract wallet, which goes to review unless the template allows contract wallets', async () => {
    const owner = (message: string) =>
      signTestPersonalMessage(message, SANDBOX_CONTRACT_WALLET_OWNER_LABEL);
    const denied = await submitted({ address: SANDBOX_CONTRACT_WALLET, sign: owner });
    const allowed = await submitted({
      address: SANDBOX_CONTRACT_WALLET,
      sign: owner,
      template: withContractWallets(true),
    });
    const first = recordingRpc(sandboxRpc());
    const second = recordingRpc(sandboxRpc());

    const review = await judge(denied, { evmRpc: first.rpc });
    const pass = await judge(allowed, { evmRpc: second.rpc });

    expect(review.check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['contract_wallet_not_allowed'],
    });
    expect(review.verification?.status).toBe('needs_review');
    expect(pass.check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'passed',
      metadata: { 'contract-wallet': true },
      provenance: { provider: { id: 'json-rpc', sandbox: false } },
    });
    expect(pass.check('crypto_wallet_statement_comparison')).toMatchObject({ status: 'passed' });
    expect(pass.verification?.status).toBe('passed');
    expect(first.calls).toEqual([
      `getCode ${TEST_CHAINS.ethereum} ${SANDBOX_CONTRACT_WALLET}`,
      `call ${TEST_CHAINS.ethereum} ${SANDBOX_CONTRACT_WALLET} gas 500000`,
    ]);
  });

  it('sends a Safe-shaped owner signature to review without an RPC (provider_not_configured), C57.6', async () => {
    const target = await submitted({
      address: SANDBOX_CONTRACT_WALLET,
      sign: (message) => signTestPersonalMessage(message, SANDBOX_CONTRACT_WALLET_OWNER_LABEL),
      template: withContractWallets(true),
    });

    const { verification, check } = await judge(target);

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
    expect(check('crypto_wallet_statement_comparison')?.status).not.toBe('passed');
    expect(verification?.status).toBe('needs_review');
  });

  it('fails a signature the contract wallet does not accept (signature_invalid)', async () => {
    const target = await submitted({
      address: SANDBOX_CONTRACT_WALLET,
      sign: (message) => signTestPersonalMessage(message, 'job/not-the-owner'),
      template: withContractWallets(true),
    });

    const { check } = await judge(target, { evmRpc: sandboxRpc() });

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'failed',
      reasons: ['signature_invalid'],
    });
  });

  it('answers provider_not_configured for a contract wallet on a chain the RPC has no node for', async () => {
    const target = await submitted({
      address: SANDBOX_CONTRACT_WALLET,
      chainId: TEST_CHAINS.base,
      sign: (message) => signTestPersonalMessage(message, SANDBOX_CONTRACT_WALLET_OWNER_LABEL),
      template: withContractWallets(true),
    });
    const { rpc } = recordingRpc(
      new ProviderError('The EVM RPC failed (chain_not_configured)', {
        retryable: false,
        code: 'chain_not_configured',
      }),
    );

    const { verification, check } = await judge(target, { evmRpc: rpc });

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
    expect(verification?.status).toBe('needs_review');
  });

  it('records a permanent RPC failure as execution_error (review), never a failure', async () => {
    const target = await submitted({
      address: SANDBOX_CONTRACT_WALLET,
      sign: (message) => signTestPersonalMessage(message, SANDBOX_CONTRACT_WALLET_OWNER_LABEL),
      template: withContractWallets(true),
    });
    const { rpc } = recordingRpc(
      new ProviderError('The EVM RPC failed (rpc_error)', { retryable: false, code: 'rpc_error' }),
    );

    const { verification, check } = await judge(target, { evmRpc: rpc });

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
    expect(verification?.status).toBe('needs_review');
  });

  it('retries a transient RPC failure, and records it as execution_error on the last attempt', async () => {
    const target = await submitted({
      address: SANDBOX_CONTRACT_WALLET,
      sign: (message) => signTestPersonalMessage(message, SANDBOX_CONTRACT_WALLET_OWNER_LABEL),
      template: withContractWallets(true),
    });
    const { rpc } = recordingRpc(
      new ProviderError('The EVM RPC failed (timeout)', { retryable: true, code: 'timeout' }),
    );
    const { deps } = setup({ evmRpc: rpc });

    await expect(
      processVerification({ environmentId, verificationId: target.verificationId }, deps),
    ).rejects.toBeInstanceOf(ProviderError);
    expect((await getVerification(db, environmentId, target.verificationId))?.status).toBe(
      'submitted',
    );

    const last = await judge(target, { evmRpc: rpc, lastAttempt: true });
    expect(last.check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('passes a Solana signature over the Sign-In with Solana message', async () => {
    const wallet = testSolanaWallet('job/solana');
    const target = await submitted({
      chainId: TEST_CHAINS.solana,
      address: wallet.address,
      sign: (message) => wallet.sign(message),
    });

    const { verification, check } = await judge(target);

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'passed',
      metadata: { scheme: 'solana-ed25519' },
    });
    expect(verification?.status).toBe('passed');
    expect(await getCryptoChallenge(db, environmentId, target.challengeId)).toMatchObject({
      scheme: 'solana-ed25519',
    });
  });

  it('fails a signature of other bytes than our challenge (statement_mismatch, signature_invalid)', async () => {
    const target = await submitted(
      alice({ sign: () => signTestPersonalMessage('some other message', ALICE) }),
    );

    const { verification, check } = await judge(target, { evmRpc: sandboxRpc() });

    expect(check('crypto_wallet_statement_comparison')?.status).not.toBe('passed');
    expect(check('crypto_wallet_address_comparison')?.status).not.toBe('passed');
    expect(verification?.status).not.toBe('passed');
  });

  it('compares the claimed address with the inquiry’s expected address at judgement', async () => {
    const target = await submitted(
      alice({ fields: { crypto_wallet_address: testWalletAddress('job/bob') } }),
    );

    const { check } = await judge(target, { evmRpc: sandboxRpc() });

    expect(check('crypto_wallet_address_comparison')).toMatchObject({
      status: 'failed',
      reasons: ['expected_address_mismatch'],
    });
  });

  it('answers input_missing, never a pass, without a submitted challenge', async () => {
    const attributes = cryptoWalletTemplateAttributes();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: inquiry.id,
      type: 'crypto_wallet',
    });
    await setVerificationStatus(db, environmentId, verificationId, { to: 'submitted' });

    const { verification } = await judge({ verificationId });

    expect(verification?.status).toBe('needs_review');
    expect(verification?.checks.every((check) => check.status !== 'passed')).toBe(true);
    expect(verification?.checks.map((check) => check.reasons)).toContainEqual(['input_missing']);
  });

  it('writes results that parse, and logs no address, signature or message', async () => {
    const target = await submitted(alice());

    const { verification, logger } = await judge(target);

    for (const check of verification?.checks ?? []) {
      expect(
        checkResultSchema.safeParse({
          name: check.name,
          status: check.status,
          type: check.type,
          reasons: check.reasons,
          metadata: check.metadata,
          stage: check.stage,
          confidence: check.confidence,
          provenance: check.provenance,
        }).success,
      ).toBe(true);
    }
    const logged = JSON.stringify(logger.entries).toLowerCase();
    expect(logged).not.toContain(testWalletAddress(ALICE).slice(2));
    expect(logged).not.toContain('wants you to sign');
    expect(JSON.stringify(verification?.checks).toLowerCase()).not.toContain(
      testWalletAddress(ALICE).slice(2),
    );
  });

  it('processes its challenge when the verification fails without a decision', async () => {
    const target = await submitted(alice());
    const { deps } = setup();

    await failVerificationAfterError(
      { environmentId, verificationId: target.verificationId },
      deps,
      'SyntheticError',
    );

    expect((await getVerification(db, environmentId, target.verificationId))?.status).toBe(
      'failed',
    );
    expect((await getCryptoChallenge(db, environmentId, target.challengeId))?.status).toBe(
      'processed',
    );
  });
});
