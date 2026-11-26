/**
 * Test wallets for the crypto wallet spec (C57, C65.4): keys derived from fixed labels through
 * SHA-256 (`openverify/test-wallet/<label>`, as the checks package and the API tests derive
 * theirs), so no key is committed, and signers that build their digests themselves. The server
 * verifies every signature; nothing here checks one.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import type { Page } from '@playwright/test';

const encoder = new TextEncoder();
const utf8 = (text: string): Uint8Array => encoder.encode(text);

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A 32-byte secret from a label: the same label always gives the same key. */
export function testPrivateKey(label: string): Uint8Array {
  return sha256(utf8(`openverify/test-wallet/${label}`));
}

/** The lower-case `0x` EVM address of a key. */
export function evmAddress(privateKey: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return `0x${hex.encode(keccak_256(publicKey.slice(1)).slice(12))}`;
}

/** EIP-191 `personal_sign` of `message`: `0x` `r‖s‖v`, v 27 or 28. */
export function personalSign(message: Uint8Array, privateKey: Uint8Array): string {
  const prefix = utf8(`\x19Ethereum Signed Message:\n${String(message.length)}`);
  const digest = keccak_256(concat(prefix, message));
  const signature = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' });
  const recovery = signature[0] ?? 0;
  return `0x${hex.encode(concat(signature.slice(1, 65), new Uint8Array([27 + recovery])))}`;
}

/** The Bitcoin mainnet P2WPKH (`bc1q…`) address of a key. */
export function bitcoinP2wpkhAddress(privateKey: Uint8Array): string {
  return btc.p2wpkh(secp256k1.getPublicKey(privateKey, true), btc.NETWORK).address;
}

function compactSize(length: number): Uint8Array {
  return length < 0xfd
    ? new Uint8Array([length])
    : new Uint8Array([0xfd, length & 0xff, length >> 8]);
}

function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(utf8(tag));
  return sha256(concat(tagHash, tagHash, message));
}

/**
 * A BIP-322 simple signature of `message` by a P2WPKH key, as C57.3 takes it: `smp` and the
 * base64 of the consensus-encoded witness of the virtual `to_sign` transaction.
 */
export function bip322SimpleSignature(message: Uint8Array, privateKey: Uint8Array): string {
  const payment = btc.p2wpkh(secp256k1.getPublicKey(privateKey, true), btc.NETWORK);
  const options = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true };
  const toSpend = new btc.Transaction({ ...options, version: 0 });
  toSpend.addOutput({ script: payment.script, amount: 0n });
  toSpend.addInput({
    txid: new Uint8Array(32),
    index: 0xffffffff,
    sequence: 0,
    finalScriptSig: concat(
      new Uint8Array([0x00, 0x20]),
      taggedHash('BIP0322-signed-message', message),
    ),
  });
  const toSign = new btc.Transaction({ ...options, version: 0 });
  toSign.addInput({
    txid: toSpend.id,
    index: 0,
    sequence: 0,
    witnessUtxo: { script: payment.script, amount: 0n },
  });
  toSign.addOutput({ script: new Uint8Array([0x6a]), amount: 0n });
  toSign.signIdx(privateKey, 0, [btc.SigHash.ALL]);
  toSign.finalizeIdx(0);
  const witness = toSign.getInput(0).finalScriptWitness ?? [];
  const encoded = concat(
    compactSize(witness.length),
    ...witness.flatMap((item) => [compactSize(item.length), item]),
  );
  return `smp${base64.encode(encoded)}`;
}

/** The wallet a page sees: the account it reports, and the key that signs. */
export interface InjectedWallet {
  readonly name: string;
  /** What `eth_requestAccounts` answers. */
  readonly account: string;
  /** The key `personal_sign` signs with: the account's own, or another one. */
  readonly signingKey: Uint8Array;
}

/**
 * Announces an EIP-1193 wallet to the page through EIP-6963, before any page script runs. Its
 * `personal_sign` is a binding to this process (`page.exposeFunction`), which signs the bytes the
 * page passes in hex; the key never enters the page.
 */
export async function injectWallet(page: Page, wallet: InjectedWallet): Promise<string[]> {
  const requests: string[] = [];
  await page.exposeFunction('openverifyE2eSign', (messageHex: string) => {
    requests.push('personal_sign');
    return personalSign(hex.decode(messageHex.replace(/^0x/u, '')), wallet.signingKey);
  });
  await page.addInitScript(
    ({ name, account }) => {
      // Looked up on each call: the binding is the test process's, installed with the page.
      const sign = (data: string) =>
        (
          window as unknown as { openverifyE2eSign: (hexData: string) => Promise<string> }
        ).openverifyE2eSign(data);
      const provider = {
        request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
          if (method === 'eth_requestAccounts') {
            return Promise.resolve([account]);
          }
          if (method === 'personal_sign' && typeof params?.[0] === 'string') {
            return sign(params[0]);
          }
          return Promise.reject(Object.assign(new Error('Unsupported method'), { code: 4200 }));
        },
      };
      window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', {
            detail: Object.freeze({
              info: {
                uuid: '0b7c2b8e-5c3e-4f5b-9f4e-0e2e5e7a9c01',
                name,
                icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
                rdns: 'test.openverify.e2e',
              },
              provider,
            }),
          }),
        );
      });
    },
    { name: wallet.name, account: wallet.account },
  );
  return requests;
}
