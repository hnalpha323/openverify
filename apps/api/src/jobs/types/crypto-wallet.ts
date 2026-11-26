/**
 * C57.4, C54.1: the `crypto_wallet` job (`api-crypto`).
 *
 * - `evaluate` reads the verification's submitted challenge (the message we issued, the claimed
 *   address, the signature and any signed bytes) and the inquiry's expected address
 *   (`crypto_wallet_address`). Only when an EVM signature recovers no matching key does it ask
 *   the environment's `evmRpc` provider, once per submit: `eth_getCode`, then, for an address
 *   holding code, ERC-1271 `isValidSignature(digest, signature)` (gas 500,000). Without a
 *   provider, or on a chain its node list lacks, the address check answers
 *   `provider_not_configured`; a provider failure is retried while BullMQ has attempts left, then
 *   recorded as `execution_error` (C30.3). Then the four checks run (`evaluateCryptoWalletChecks`).
 * - `persistInDecisionTx` marks the challenge `processed` with the scheme the signature was
 *   checked under, before the verification event, so its payload carries the scheme.
 * - `onProcessingFailed` marks it `processed` too, so no challenge stays `submitted` for good.
 *
 * Nothing here logs an address, a signature or a message; results carry levels and flags only.
 */
import {
  cryptoWalletContext,
  cryptoWalletContractCheck,
  evaluateCryptoWalletChecks,
  type ContractWalletResult,
  type CryptoWalletCheckInput,
  type EvmContractCheck,
  type ProviderOutcome,
} from '@openverify/checks';
import {
  cryptoSignatureSchemeSchema,
  type CryptoSignatureScheme,
  type VerificationTemplateConfig,
} from '@openverify/core';
import {
  getSubmittedCryptoChallenge,
  markCryptoChallengeProcessed,
  openCryptoChallengeEvidence,
  type Db,
} from '@openverify/db';
import { ProviderError } from '../../providers/errors.js';
import {
  ERC1271_CALL_GAS,
  encodeIsValidSignatureCall,
  holdsContractCode,
  isErc1271MagicResult,
} from '../../providers/evm-rpc/erc1271.js';
import { expectedCryptoAddressOf } from '../../services/crypto-challenges/rules.js';
import { attemptProvider } from '../attempts.js';
import type { ProcessVerificationDeps } from '../process-verification.js';
import type { TypeEvaluationJob, VerificationTypeJob } from './index.js';

/** What the decision hooks need: the challenge judged, and the scheme it was checked under. */
export interface CryptoWalletDecisionState {
  /** The submitted challenge, or `null` when the verification had none. */
  challengeId: string | null;
  /** The scheme the signature was checked under, or `null` when none was established. */
  scheme: CryptoSignatureScheme | null;
}

/** The checks that read the signature's verification, and so the contract wallet answer. */
const SIGNATURE_CHECKS = [
  'crypto_wallet_address_comparison',
  'crypto_wallet_statement_comparison',
] as const;

/** The scheme a stored submit named, when it is one Phase 5 knows. */
function schemeOf(value: string | null | undefined): CryptoSignatureScheme | null {
  const parsed = cryptoSignatureSchemeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The checks' input from the verification's submitted challenge and the inquiry's fields. */
async function inputOf(
  db: Db,
  job: TypeEvaluationJob,
): Promise<{ challengeId: string | null; input: CryptoWalletCheckInput }> {
  const challenge = await getSubmittedCryptoChallenge(db, job.environmentId, job.verificationId);
  const evidence =
    challenge === null
      ? null
      : await openCryptoChallengeEvidence(db, job.environmentId, challenge.id);
  return {
    challengeId: challenge?.id ?? null,
    input: {
      chainId: challenge?.chainId ?? null,
      walletAddress: evidence?.walletAddress ?? null,
      expectedAddress: expectedCryptoAddressOf(job.inquiry.fields),
      challenge: evidence?.message == null ? null : { message: evidence.message },
      submission:
        evidence?.signature == null
          ? null
          : {
              signature: evidence.signature,
              signedMessage: evidence.signedMessage,
              scheme: schemeOf(challenge?.scheme),
            },
    },
  };
}

/** Says a chain has no node: the check then answers `provider_not_configured`, not an error. */
const NO_NODE = Symbol('no node for the chain');

/**
 * C57.4, C57.5: the `evmRpc` answer for a contract check: the code at the address and, when it
 * holds code, whether ERC-1271 accepted the signature (one call).
 */
async function askContractWallet(
  deps: ProcessVerificationDeps,
  job: TypeEvaluationJob,
  chainId: string,
  check: EvmContractCheck,
): Promise<ProviderOutcome<ContractWalletResult>> {
  const provider = deps.providers?.[job.environmentKind]?.evmRpc;
  if (provider === undefined) {
    return { kind: 'not_configured' };
  }
  const answered = await attemptProvider(
    async (): Promise<ContractWalletResult | typeof NO_NODE> => {
      try {
        const code = await provider.getCode(chainId, check.address);
        if (!holdsContractCode(code)) {
          return { hasCode: false, signatureValid: null };
        }
        const result = await provider.call(chainId, {
          to: check.address,
          data: encodeIsValidSignatureCall(check.digest, check.signature),
          gas: ERC1271_CALL_GAS,
        });
        return { hasCode: true, signatureValid: isErc1271MagicResult(result) };
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'chain_not_configured') {
          return NO_NODE;
        }
        throw error;
      }
    },
    {
      lastAttempt: job.lastAttempt,
      logger: deps.logger,
      log: { verificationId: job.verificationId, check: 'crypto_wallet_address_comparison' },
    },
  );
  if (!answered.ok) {
    return { kind: 'error' };
  }
  return answered.value === NO_NODE
    ? { kind: 'not_configured' }
    : {
        kind: 'result',
        provider: { id: provider.id, sandbox: provider.sandbox },
        result: answered.value,
      };
}

/** The scheme the signature was checked under, when the bytes were a signature of it. */
function establishedScheme(
  input: CryptoWalletCheckInput,
  config: VerificationTemplateConfig,
): CryptoSignatureScheme | null {
  const { verification } = cryptoWalletContext(input, config);
  return verification?.outcome === 'verified' ||
    verification?.outcome === 'address_mismatch' ||
    verification?.outcome === 'not_recovered'
    ? verification.scheme
    : null;
}

export const cryptoWalletJob: VerificationTypeJob<CryptoWalletDecisionState> = {
  type: 'crypto_wallet',
  runnable: true,
  async evaluate(deps, job) {
    const { challengeId, input } = await inputOf(deps.db, job);
    const asks = SIGNATURE_CHECKS.some((name) => job.config.checks[name]?.enabled === true);
    const contractCheck = asks ? cryptoWalletContractCheck(input, job.config) : null;
    const evaluated: CryptoWalletCheckInput =
      contractCheck === null || input.chainId === null
        ? input
        : {
            ...input,
            contractWallet: await askContractWallet(deps, job, input.chainId, contractCheck),
          };
    return {
      results: evaluateCryptoWalletChecks(evaluated, job.config),
      state: { challengeId, scheme: establishedScheme(evaluated, job.config) },
    };
  },
  async persistInDecisionTx(tx, ctx) {
    const { challengeId, scheme } = ctx.state;
    if (ctx.status !== 'submitted' && challengeId !== null) {
      // C40.6: the inquiry and the verification are locked; the challenge is the sub-resource.
      await markCryptoChallengeProcessed(tx, ctx.environmentId, challengeId, { scheme });
    }
    return ctx.verificationEvent();
  },
  async onProcessingFailed(tx, ctx) {
    const challenge = await getSubmittedCryptoChallenge(tx, ctx.environmentId, ctx.verificationId);
    if (challenge !== null) {
      await markCryptoChallengeProcessed(tx, ctx.environmentId, challenge.id);
    }
    return [];
  },
};
