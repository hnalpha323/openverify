/**
 * The challenge a wallet signs (C57.2), built by the server: EIP-4361 (Sign-In with Ethereum) for
 * EVM chains, Sign-In with Solana for Solana, and the same fields in the CAIP-122 wording for the
 * other chains, with the flow's origin as the domain and URI, our statement naming the
 * organization, a single-use nonce, `Issued At`, `Expiration Time` and the verification id as
 * `Request ID`. The statement keeps only the characters the EIP-4361 grammar allows (unreserved,
 * reserved and space), so the organization name is folded to ASCII.
 *
 * `parseSignInMessage` reads a message of this grammar back, strictly; the statement comparison
 * itself compares bytes (C57.4), never parsed fields.
 */
import { CRYPTO_CHAINS, cryptoChainFamily } from '@openverify/core';
import { sanitizeOrganizationName } from '../contact/organization-name.js';
import { validateCryptoAddress } from './addresses.js';
import { toEip55Address } from './eip55.js';

/** What the server puts in a challenge. */
export interface CryptoChallengeFields {
  /** A canonical CAIP-2 chain id Phase 5 knows. */
  chainId: string;
  /** The claimed address (an EVM address is written in its EIP-55 form). */
  address: string;
  /** `OPENVERIFY_FLOW_PUBLIC_URL`: an `http` or `https` URL, never a request header. */
  origin: string;
  /** The organization's name, sanitised here (C55.9). */
  organizationName: string;
  /** At least 8 ASCII letters and digits (the route issues 16 base62 characters). */
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  /** The verification id. */
  requestId: string;
}

/** The fields of a sign-in message (EIP-4361, Sign-In with Solana or CAIP-122). */
export interface SignInMessage {
  /** The scheme when written (`https://example.com wants you …`), else `null`. */
  scheme: string | null;
  /** The RFC 3986 authority: host and optional port. */
  domain: string;
  /** The account kind named in the first line: `Ethereum`, `Solana`, `Bitcoin`, … */
  accountKind: string;
  address: string;
  statement: string | null;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string | null;
  notBefore: string | null;
  requestId: string | null;
  resources: readonly string[];
}

/** The statement our challenges carry: the organization asks the user to prove control. */
export function cryptoChallengeStatement(organizationName: string): string {
  const name = toStatementText(sanitizeOrganizationName(organizationName));
  return name === ''
    ? `Prove you control this wallet. ${STATEMENT_TAIL}`
    : `${name} asks you to prove you control this wallet. ${STATEMENT_TAIL}`;
}

/**
 * Builds the challenge message for its chain's family.
 * @throws {Error} for an unknown chain, a nonce shorter than 8 alphanumerics, an origin that is
 * not an http(s) URL, a request id outside the RFC 3986 `pchar` set, or an expiry before issue.
 */
export function buildCryptoChallengeMessage(fields: CryptoChallengeFields): string {
  const family = cryptoChainFamily(fields.chainId);
  if (family === null) {
    throw new Error('the chain is not one Phase 5 knows');
  }
  if (!validateCryptoAddress(fields.chainId, fields.address).valid) {
    throw new Error('the address is not an address of the chain');
  }
  if (!NONCE.test(fields.nonce)) {
    throw new Error('the nonce must be at least 8 ASCII letters and digits');
  }
  const origin = parseOrigin(fields.origin);
  if (fields.requestId.length > REQUEST_ID_MAX_LENGTH || !PCHARS.test(fields.requestId)) {
    throw new Error('the request id must be RFC 3986 pchar characters');
  }
  if (!(fields.expiresAt.getTime() > fields.issuedAt.getTime())) {
    throw new Error('the expiry must follow the issue time');
  }
  const address = family === 'evm' ? toEip55Address(fields.address.slice(2)) : fields.address;
  const authority =
    origin.protocol === 'https:' ? origin.host : `${origin.protocol.slice(0, -1)}://${origin.host}`;
  return [
    `${authority}${HEADER}${accountKindOf(fields.chainId)} account:`,
    address,
    '',
    cryptoChallengeStatement(fields.organizationName),
    '',
    `URI: ${origin.href}`,
    'Version: 1',
    `Chain ID: ${chainIdFieldOf(fields.chainId)}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expiresAt.toISOString()}`,
    `Request ID: ${fields.requestId}`,
  ].join('\n');
}

/** Parses a sign-in message strictly by its grammar; `null` when it does not conform. */
export function parseSignInMessage(text: string): SignInMessage | null {
  if (text.length > MESSAGE_MAX_LENGTH) {
    return null;
  }
  const lines = text.split('\n');
  if (lines.some((line) => line.length > LINE_MAX_LENGTH || line.includes('\r'))) {
    return null;
  }
  const header = parseHeader(lines[0] ?? '');
  const address = lines[1] ?? '';
  if (header === null || !addressFits(header.accountKind, address) || lines[2] !== '') {
    return null;
  }
  let index = 3;
  let statement: string | null = null;
  if (lines[3] === '') {
    index = 4;
  } else if (!(lines[3] ?? '').startsWith('URI: ')) {
    statement = lines[3] ?? '';
    if (!STATEMENT.test(statement) || lines[4] !== '') {
      return null;
    }
    index = 5;
  }
  const take = (prefix: string, required: boolean): string | null | undefined => {
    const line = lines[index];
    if (line?.startsWith(prefix) === true) {
      index += 1;
      return line.slice(prefix.length);
    }
    return required ? undefined : null;
  };
  const uri = take('URI: ', true);
  const version = take('Version: ', true);
  const chainId = take('Chain ID: ', true);
  const nonce = take('Nonce: ', true);
  const issuedAt = take('Issued At: ', true);
  const expirationTime = take('Expiration Time: ', false);
  const notBefore = take('Not Before: ', false);
  const requestId = take('Request ID: ', false);
  const resources = lines[index] === 'Resources:' ? lines.slice(index + 1) : [];
  index = lines[index] === 'Resources:' ? lines.length : index;
  if (
    index !== lines.length ||
    !isUri(uri) ||
    version !== '1' ||
    !chainIdFits(header.accountKind, chainId) ||
    nonce === undefined ||
    nonce === null ||
    !NONCE.test(nonce) ||
    !isTimestamp(issuedAt) ||
    (expirationTime !== null && !isTimestamp(expirationTime)) ||
    (notBefore !== null && !isTimestamp(notBefore)) ||
    (requestId !== null && requestId !== undefined && !PCHARS_OR_EMPTY.test(requestId)) ||
    !resources.every((line) => line.startsWith('- ') && isUri(line.slice(2)))
  ) {
    return null;
  }
  return {
    ...header,
    address,
    statement,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime: expirationTime ?? null,
    notBefore: notBefore ?? null,
    requestId: requestId ?? null,
    resources: resources.map((line) => line.slice(2)),
  };
}

const HEADER = ' wants you to sign in with your ';
const STATEMENT_TAIL = 'Signing is free and moves no funds.';
/** Our messages stay far below the 4 KiB bound; the parser reads at most four times that. */
const MESSAGE_MAX_LENGTH = 16_384;
const LINE_MAX_LENGTH = 2_048;
const REQUEST_ID_MAX_LENGTH = 128;
const NONCE = /^[A-Za-z\d]{8,}$/u;
/** RFC 3986 `pchar`: unreserved, percent-encoded, sub-delims, `:` and `@`. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const PCHARS = /^(?:[\w.~!$&'()*+,;=:@-]|%[\dA-Fa-f]{2})+$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const PCHARS_OR_EMPTY = /^(?:[\w.~!$&'()*+,;=:@-]|%[\dA-Fa-f]{2})*$/u;
/** EIP-4361 `statement`: RFC 3986 reserved and unreserved characters and space, no line break. */
const STATEMENT = /^[\w.~:/?#[\]@!$&'()*+,;= -]+$/u;
const STATEMENT_CHARACTER = /[\w.~:/?#[\]@!$&'()*+,;= -]/u;
const SCHEME = /^[a-z][\d+.a-z-]*$/u;
const AUTHORITY = /^[^\s/?#]+$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ACCOUNT_KIND = /^[A-Za-z]+(?: [A-Za-z]+)*$/u;
const EVM_ADDRESS = /^0x[\dA-Fa-f]{40}$/u;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const OTHER_ADDRESS = /^\S{1,128}$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SOLANA_CHAIN_IDS = new Set([
  'mainnet',
  'testnet',
  'devnet',
  'localnet',
  'solana:mainnet',
  'solana:testnet',
  'solana:devnet',
]);

/** The organization name in the characters an EIP-4361 statement allows, folded to ASCII. */
function toStatementText(name: string): string {
  return Array.from(name.normalize('NFKD'))
    .filter((character) => STATEMENT_CHARACTER.test(character))
    .join('')
    .split(' ')
    .filter((word) => word !== '')
    .join(' ');
}

function parseOrigin(origin: string): URL {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('the origin must be an http or https URL');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.host === ''
  ) {
    throw new Error('the origin must be an http or https URL without credentials');
  }
  return url;
}

function accountKindOf(chainId: string): string {
  const family = cryptoChainFamily(chainId);
  if (family === 'evm') {
    return 'Ethereum';
  }
  return CRYPTO_CHAINS.find((chain) => chain.id === chainId)?.name ?? chainId;
}

function chainIdFieldOf(chainId: string): string {
  const family = cryptoChainFamily(chainId);
  if (family === 'evm') {
    return chainId.slice('eip155:'.length);
  }
  return family === 'solana' ? 'mainnet' : chainId;
}

function parseHeader(
  line: string,
): Pick<SignInMessage, 'scheme' | 'domain' | 'accountKind'> | null {
  const at = line.indexOf(HEADER);
  if (at <= 0 || !line.endsWith(' account:')) {
    return null;
  }
  const origin = line.slice(0, at);
  const accountKind = line.slice(at + HEADER.length, -' account:'.length);
  const separator = origin.indexOf('://');
  const scheme = separator === -1 ? null : origin.slice(0, separator);
  const domain = separator === -1 ? origin : origin.slice(separator + 3);
  if (
    (scheme !== null && !SCHEME.test(scheme)) ||
    !AUTHORITY.test(domain) ||
    !ACCOUNT_KIND.test(accountKind)
  ) {
    return null;
  }
  return { scheme, domain, accountKind };
}

function addressFits(accountKind: string, address: string): boolean {
  if (accountKind === 'Ethereum') {
    return EVM_ADDRESS.test(address);
  }
  return accountKind === 'Solana' ? BASE58_ADDRESS.test(address) : OTHER_ADDRESS.test(address);
}

function chainIdFits(accountKind: string, chainId: string | null | undefined): chainId is string {
  if (chainId === null || chainId === undefined || chainId === '') {
    return false;
  }
  if (accountKind === 'Ethereum') {
    return /^\d+$/u.test(chainId);
  }
  return accountKind === 'Solana' ? SOLANA_CHAIN_IDS.has(chainId) : !/\s/u.test(chainId);
}

function isUri(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && !/\s/u.test(value) && URL.canParse(value);
}

function isTimestamp(value: string | null | undefined): value is string {
  return (
    value !== null &&
    value !== undefined &&
    TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
