import { describe, expect, it } from 'vitest';
import {
  BITCOIN,
  ETHEREUM,
  SANDBOX_CONTRACT_WALLET,
  SOLANA,
  SYNTHETIC_BITCOIN_ADDRESS,
  WALLET_ADDRESS,
  contractWalletVerification,
  cryptoWalletVerification,
  looseBitcoinVerification,
  solanaEnvelopeVerification,
  solanaProgramAccountVerification,
  walletChecks,
} from '../testing/fixtures/crypto-wallet';
import { cryptoWalletEvidenceOf } from './crypto-wallet-evidence';

describe('cryptoWalletEvidenceOf (C52.8, C57, C66)', () => {
  it('reads the address, the chain, the scheme, the address type, the checksum and the flags', () => {
    expect(cryptoWalletEvidenceOf(cryptoWalletVerification())).toEqual({
      walletAddress: WALLET_ADDRESS,
      expectedAddress: null,
      chainId: ETHEREUM,
      scheme: 'eip191',
      addressType: 'evm',
      checksum: 'absent',
      flags: [{ flag: 'high-s', value: false }],
      rpc: null,
    });
  });

  it('reads both addresses as the API masked them, and keeps the chain and scheme (C53.7)', () => {
    const masked = cryptoWalletVerification({
      masked: true,
      attributes: { 'expected-address': WALLET_ADDRESS },
    });

    expect(cryptoWalletEvidenceOf(masked)).toMatchObject({
      walletAddress: null,
      expectedAddress: null,
      chainId: ETHEREUM,
      scheme: 'eip191',
    });
  });

  it('reads the expected address the inquiry set (C57.2)', () => {
    const expected = cryptoWalletVerification({
      attributes: { 'expected-address': WALLET_ADDRESS },
    });

    expect(cryptoWalletEvidenceOf(expected).expectedAddress).toBe(WALLET_ADDRESS);
  });

  it('reads a contract wallet flag (C57.4)', () => {
    expect(cryptoWalletEvidenceOf(contractWalletVerification())).toMatchObject({
      walletAddress: SANDBOX_CONTRACT_WALLET,
      flags: [
        { flag: 'high-s', value: false },
        { flag: 'contract-wallet', value: true },
      ],
    });
  });

  it('reads a high-s signature read loosely, in the listed order (C57.4)', () => {
    expect(cryptoWalletEvidenceOf(looseBitcoinVerification())).toMatchObject({
      walletAddress: SYNTHETIC_BITCOIN_ADDRESS,
      chainId: BITCOIN,
      scheme: 'bip137',
      addressType: 'p2pkh',
      checksum: 'valid',
      flags: [
        { flag: 'high-s', value: true },
        { flag: 'bip137-loose', value: true },
      ],
    });
  });

  it('reads whether a Solana address is on the curve, and an unwrapped envelope (C57.1, C57.4)', () => {
    expect(cryptoWalletEvidenceOf(solanaProgramAccountVerification())).toMatchObject({
      chainId: SOLANA,
      addressType: 'solana',
      checksum: 'none',
      flags: [{ flag: 'on-curve', value: false }],
    });
    expect(cryptoWalletEvidenceOf(solanaEnvelopeVerification()).flags).toEqual([
      { flag: 'on-curve', value: true },
      { flag: 'envelope', value: 'solana-offchain-v1' },
    ]);
  });

  it('takes the scheme from the address check before a challenge was consumed', () => {
    const unconsumed = cryptoWalletVerification({ attributes: { 'signature-scheme': null } });

    expect(cryptoWalletEvidenceOf(unconsumed).scheme).toBe('eip191');
  });

  it('has no check evidence before the checks ran', () => {
    const initiated = cryptoWalletVerification({
      attributes: { status: 'initiated', 'signature-scheme': null, checks: [] },
    });

    expect(cryptoWalletEvidenceOf(initiated)).toMatchObject({
      walletAddress: WALLET_ADDRESS,
      chainId: ETHEREUM,
      scheme: null,
      addressType: null,
      checksum: null,
      flags: [],
    });
  });

  it('counts metadata of the wrong shape as not recorded', () => {
    const odd = cryptoWalletVerification({
      attributes: {
        'signature-scheme': null,
        checks: walletChecks({
          validity: { metadata: { checksum: 1, 'address-type': ['evm'], 'on-curve': 'yes' } },
          statement: { metadata: { envelope: false } },
          address: { metadata: { scheme: {}, 'high-s': 'true', 'contract-wallet': 1 } },
        }),
      },
    });

    expect(cryptoWalletEvidenceOf(odd)).toMatchObject({
      scheme: null,
      addressType: null,
      checksum: null,
      flags: [],
    });
  });

  it('reads the EVM RPC the address check asked about a contract wallet, and whether it is a sandbox (C57.5, ADR 0002 §3d)', () => {
    expect(cryptoWalletEvidenceOf(contractWalletVerification()).rpc).toEqual({
      id: 'sandbox',
      sandbox: true,
    });
    expect(cryptoWalletEvidenceOf(looseBitcoinVerification()).rpc).toBeNull();
  });
});
