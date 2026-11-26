/** C57.2: the challenge builder, and the strict sign-in parser on the EIP-4361 examples. */
import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import {
  buildCryptoChallengeMessage,
  cryptoChallengeStatement,
  parseSignInMessage,
  type CryptoChallengeFields,
} from './messages.js';
import {
  BITCOIN_CHAIN,
  ETHEREUM_CHAIN,
  SOLANA_CHAIN,
  TRON_CHAIN,
  XRPL_CHAIN,
  bitcoinTestAddresses,
  evmTestAddress,
  solanaTestKey,
  testPrivateKey,
  tronTestAddress,
} from './testing.js';
import { EIP4361_EXAMPLE_MESSAGES } from './vectors/ethereum.js';

const EVM_ADDRESS = evmTestAddress(testPrivateKey('messages/evm'));
const ISSUED = new Date('2026-10-23T09:00:00.000Z');
const EXPIRES = new Date('2026-10-23T09:10:00.000Z');

const fields = (overrides: Partial<CryptoChallengeFields> = {}): CryptoChallengeFields => ({
  chainId: ETHEREUM_CHAIN,
  address: EVM_ADDRESS,
  origin: 'https://verify.example.org',
  organizationName: 'Utopia Water Board',
  nonce: 'a1B2c3D4e5F6g7H8',
  issuedAt: ISSUED,
  expiresAt: EXPIRES,
  requestId: 'ver_01M5CKJ8K5G4T7N3DPAEH5XR2G',
  ...overrides,
});

const STATEMENT =
  'Utopia Water Board asks you to prove you control this wallet. Signing is free and moves no funds.';

describe('cryptoChallengeStatement (C57.2)', () => {
  it('names the organization, sanitised and folded to the characters EIP-4361 allows', () => {
    expect(cryptoChallengeStatement('Utopia Water Board')).toBe(STATEMENT);
    expect(cryptoChallengeStatement('Café Zürich "Ltd" <ok> 50%')).toBe(
      'Cafe Zurich Ltd ok 50 asks you to prove you control this wallet. Signing is free and moves no funds.',
    );
    expect(cryptoChallengeStatement('Acme https://evil.example 123456')).toBe(
      'Acme asks you to prove you control this wallet. Signing is free and moves no funds.',
    );
  });

  it('falls back to a statement without a name', () => {
    expect(cryptoChallengeStatement('')).toBe(
      'Prove you control this wallet. Signing is free and moves no funds.',
    );
    expect(cryptoChallengeStatement('東京')).toBe(
      'Prove you control this wallet. Signing is free and moves no funds.',
    );
  });
});

describe('buildCryptoChallengeMessage (C57.2)', () => {
  it('writes EIP-4361 for an EVM chain, with the address in its EIP-55 form', () => {
    const message = buildCryptoChallengeMessage(fields());
    const checksummed = parseSignInMessage(message)?.address ?? '';
    expect(checksummed.toLowerCase()).toBe(EVM_ADDRESS);
    expect(checksummed).not.toBe(EVM_ADDRESS);
    expect(message).toBe(
      [
        'verify.example.org wants you to sign in with your Ethereum account:',
        checksummed,
        '',
        STATEMENT,
        '',
        'URI: https://verify.example.org/',
        'Version: 1',
        'Chain ID: 1',
        'Nonce: a1B2c3D4e5F6g7H8',
        'Issued At: 2026-10-23T09:00:00.000Z',
        'Expiration Time: 2026-10-23T09:10:00.000Z',
        'Request ID: ver_01M5CKJ8K5G4T7N3DPAEH5XR2G',
      ].join('\n'),
    );
  });

  it('writes the chain id of any EVM chain and names a non-https scheme and a port', () => {
    const message = buildCryptoChallengeMessage(
      fields({ chainId: 'eip155:8453', origin: 'http://localhost:5173/flow' }),
    );
    expect(message.split('\n')[0]).toBe(
      'http://localhost:5173 wants you to sign in with your Ethereum account:',
    );
    expect(parseSignInMessage(message)).toMatchObject({
      scheme: 'http',
      domain: 'localhost:5173',
      uri: 'http://localhost:5173/flow',
      chainId: '8453',
    });
  });

  it('writes Sign-In with Solana for Solana, on its mainnet', () => {
    const { address } = solanaTestKey('messages');
    const message = buildCryptoChallengeMessage(fields({ chainId: SOLANA_CHAIN, address }));
    expect(message.split('\n').slice(0, 2)).toEqual([
      'verify.example.org wants you to sign in with your Solana account:',
      address,
    ]);
    expect(parseSignInMessage(message)).toMatchObject({
      accountKind: 'Solana',
      address,
      statement: STATEMENT,
      chainId: 'mainnet',
    });
  });

  it('writes the same fields in the CAIP-122 wording for the other chains', () => {
    const bitcoin = bitcoinTestAddresses(testPrivateKey('messages/btc'), 'bitcoin').p2wpkh;
    const tron = tronTestAddress(testPrivateKey('messages/tron'));
    for (const [chainId, address, kind] of [
      [BITCOIN_CHAIN, bitcoin, 'Bitcoin'],
      [TRON_CHAIN, tron, 'TRON'],
      [XRPL_CHAIN, 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'XRP Ledger'],
    ] as const) {
      const message = buildCryptoChallengeMessage(fields({ chainId, address }));
      expect(parseSignInMessage(message)).toEqual({
        scheme: null,
        domain: 'verify.example.org',
        accountKind: kind,
        address,
        statement: STATEMENT,
        uri: 'https://verify.example.org/',
        version: '1',
        chainId,
        nonce: 'a1B2c3D4e5F6g7H8',
        issuedAt: '2026-10-23T09:00:00.000Z',
        expirationTime: '2026-10-23T09:10:00.000Z',
        notBefore: null,
        requestId: 'ver_01M5CKJ8K5G4T7N3DPAEH5XR2G',
        resources: [],
      });
    }
  });

  it('stays within 4 KiB with the longest name and request id', () => {
    const message = buildCryptoChallengeMessage(
      fields({ organizationName: 'x'.repeat(500), requestId: 'v'.repeat(64) }),
    );
    expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(4096);
    expect(message).not.toContain('\r');
  });

  it.each([
    ['an unknown chain', { chainId: 'cosmos:cosmoshub-4' }, /chain/],
    ['an address not of the chain', { address: 'not-an-address' }, /address/],
    ['a short nonce', { nonce: 'abc1234' }, /nonce/],
    ['a nonce with a symbol', { nonce: 'abcd-1234-efgh' }, /nonce/],
    ['a non-http origin', { origin: 'ftp://verify.example.org' }, /origin/],
    ['an origin with credentials', { origin: 'https://user:pass@verify.example.org' }, /origin/],
    ['an origin that is no URL', { origin: 'verify.example.org' }, /origin/],
    ['a request id with a space', { requestId: 'ver 1' }, /request id/],
    ['a request id with a line break', { requestId: 'ver\n1' }, /request id/],
    [
      'an expiry before the issue time',
      { expiresAt: new Date('2026-10-23T08:59:59.000Z') },
      /expir/,
    ],
  ] as const)('refuses %s', (_why, overrides, message) => {
    expect(() => buildCryptoChallengeMessage(fields(overrides))).toThrow(message);
  });
});

describe('parseSignInMessage', () => {
  it('reads the three EIP-4361 example messages', () => {
    const parsed = EIP4361_EXAMPLE_MESSAGES.map(parseSignInMessage);
    for (const message of parsed) {
      expect(message).toMatchObject({
        accountKind: 'Ethereum',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        statement: 'I accept the ExampleOrg Terms of Service: https://example.com/tos',
        uri: 'https://example.com/login',
        version: '1',
        chainId: '1',
        nonce: '32891756',
        issuedAt: '2021-09-30T16:25:24Z',
        expirationTime: null,
        notBefore: null,
        requestId: null,
        resources: [
          'ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/',
          'https://example.com/my-web2-claim.json',
        ],
      });
    }
    expect(parsed.map((message) => [message?.scheme, message?.domain])).toEqual([
      [null, 'example.com'],
      [null, 'example.com:3388'],
      ['https', 'example.com'],
    ]);
  });

  const example = EIP4361_EXAMPLE_MESSAGES[0] ?? '';

  it.each([
    ['CRLF line ends', example.replaceAll('\n', '\r\n')],
    ['a trailing line break', `${example}\n`],
    ['no version', example.replace('Version: 1\n', '')],
    ['version 2', example.replace('Version: 1', 'Version: 2')],
    ['a short nonce', example.replace('Nonce: 32891756', 'Nonce: 3289175')],
    ['an issue time that is not RFC 3339', example.replace('2021-09-30T16:25:24Z', 'yesterday')],
    ['fields out of order', example.replace('Version: 1\nChain ID: 1', 'Chain ID: 1\nVersion: 1')],
    ['an unknown field', example.replace('Version: 1', 'Version: 1\nColour: blue')],
    ['a statement with a quote', example.replace('I accept', 'I "accept"')],
    [
      'an address that is no EVM address',
      example.replace('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0x1234'),
    ],
    ['an empty message', ''],
    ['another header', example.replace('wants you to sign in', 'asks you to sign in')],
  ])('refuses %s', (_why, text) => {
    expect(parseSignInMessage(text)).toBeNull();
  });

  it('reads a message without a statement', () => {
    const lines = example.split('\n');
    const withoutStatement = [...lines.slice(0, 2), '', ...lines.slice(4)].join('\n');
    expect(parseSignInMessage(withoutStatement)).toMatchObject({
      statement: null,
      nonce: '32891756',
    });
  });

  it('stays fast on a long hostile message', () => {
    expect(
      cpuMilliseconds(() => {
        parseSignInMessage(
          `${'a'.repeat(100_000)} wants you to sign in with your Ethereum account:\n`,
        );
        parseSignInMessage('x\n'.repeat(50_000));
      }),
    ).toBeLessThan(500);
  });
});
