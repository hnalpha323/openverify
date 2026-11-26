/**
 * C94.4 (Workflow 7A): `identifierKey`, the keyed identifier of devices (and, from 7B, list items
 * and graph keys), and `blindIndexKeyId`. The expected values were computed with an independent
 * HMAC implementation (OpenSSL 3.0.13), the environment subkey first, then the HMAC under it:
 *   printf '%s' 'openverify/blind-index/v1|env_01K0000000000000000000SBXA' \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:0001...1f          # the subkey, hex
 *   printf '%s' 'openverify/browser-fingerprint/v1|{"canvas":"synthetic"}' \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:<subkey>
 *   printf '%s' 'openverify/blind-index-key-id/v1' \
 *     | openssl dgst -sha256 -mac HMAC -macopt hexkey:0001...1f -binary | head -c 8 | base64
 * (the last made base64url without padding).
 */
import { GRAPH_KIND_REGISTRY, GRAPH_KINDS, LIST_KEY_KINDS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  BLIND_INDEX_KEY_ID_LABEL,
  BlindIndexKeyError,
  IDENTIFIER_KEY_LABELS,
  blindIndexKeyId,
  identifierKey,
} from './blind-index.js';

/** Bytes 0x00..0x1f: a public test key, never a deployment's. */
const TEST_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const SANDBOX = 'env_01K0000000000000000000SBXA';
const PRODUCTION = 'env_01K0000000000000000000PRDA';
const INPUT = '{"canvas":"synthetic"}';

describe('identifierKey (C94.4)', () => {
  it('has one label per 7A identifier kind', () => {
    expect(IDENTIFIER_KEY_LABELS).toMatchObject({
      'browser-fingerprint': 'openverify/browser-fingerprint/v1',
      'device-class': 'openverify/device-class/v1',
      'android-id': 'openverify/android-id/v1',
    });
    expect(Object.isFrozen(IDENTIFIER_KEY_LABELS)).toBe(true);
  });

  it('has one label per list key kind and per graph or transaction key (C98.2, C101.2, C105.4)', () => {
    const graphKeys = GRAPH_KINDS.map((kind) => GRAPH_KIND_REGISTRY[kind].key).filter((key) =>
      key.startsWith('identifier-'),
    );
    for (const kind of [...LIST_KEY_KINDS, ...graphKeys, 'identifier-transaction-field']) {
      expect(IDENTIFIER_KEY_LABELS, kind).toHaveProperty([kind], `openverify/${kind}/v1`);
    }
  });

  it.each([
    ['identifier-string', '52113e832ec4c2fa097e481db1b3a5135d4c385a20a5351430d38776f156ae29'],
    ['identifier-email', 'e7972c864ea1f8f02a9bbd0976ec4cefce7bb2df742025e1a335e36ec11fa311'],
    ['identifier-email-domain', 'f5894b0bb4df9bc976a7dc14092054d2280155e86228f779e03ae339be76754a'],
    ['identifier-phone', '4e5393870a93ef957ab0c83dc741d343924d31240d36d2e09ad3ec1be826f951'],
    [
      'identifier-government-id-number',
      'e397588cffd3718d279cd3495001d31a7b71e0863f839fcb0e20f23cbcccea27',
    ],
    ['identifier-name', 'f4ae99ac1cc5ab0d25433e067adae8f584a38716ea5472e0343540b2ad2573ca'],
    ['identifier-name-last', '561448bb251530e32f3f208671ae6e79d48ef6da872dcdc636101c301032d3f6'],
    ['identifier-ip', '942025869b5c70987c1ed4f245d704d6399a50f6e8eb85dab04486c521c4cd96'],
    ['identifier-ip-range', 'c42beabd74a6aa1b4695c559c484134c8057cc1a8a368b8a6d5598cef9c315d6'],
    ['identifier-country', 'e35ac99ca098271de272a30ebadfbcdc1650a1dbe48d702d21b1d596654b4c6c'],
    ['identifier-geolocation', '9c00600d7e077ad68bb5382a68c5d89b3a86d02b111c743454b7e50bacc95bdf'],
    [
      'identifier-browser-fingerprint',
      'ddd1e2574ffc0abdf5e43161f04326eb3b5630e9dfdcb47d34e492876d62b491',
    ],
    [
      'identifier-device-fingerprint',
      '7ccc1fa61cc3255765ada256739ac35cd35c35849b2ec86bbea0a697eac1e067',
    ],
    ['identifier-field', 'd88aeb7a8737919c9f2551f35c86e39cacabe2705f044e051757808cb1d4bc9f'],
    ['identifier-reference-id', 'c89c090e5e8c2ecd6f5b8a4bbb34ac72e390f864be862604089d56136db6d492'],
    [
      'identifier-name-birthdate',
      'e0cea934f8bc0edbcb95190d7ba4012a8334096b57bc7fa0c5c5c9e8fcfce636',
    ],
    ['identifier-address', 'ba51f915c87c3fc96c68111e60aba202b088d7913d7ead57fecb5f30de3e7483'],
    ['identifier-postal-code', 'f5457cdc135e2954a6c6e79b5c8c50414be1fae6b88fc80c32df6909a40b149f'],
    ['identifier-birthdate', '667b02f044ff255af0437d4de9d435f5b74836c4b79857a26a8ca6506353d34d'],
    [
      'identifier-transaction-field',
      'e060d602ba58d08fa1ca24c73e8117b0268a89427def24b3fc8884609b39f659',
    ],
    // Workflow 8B Stage 4 (C136.4): the case field label, by the same recipe.
    ['identifier-case-field', '4759febc5bcac1f9ba357e2b44127f7dd9820c28d85c4c19b585acd8cd390d06'],
  ] as const)('matches the OpenSSL vector for %s (Workflow 7B)', (kind, expected) => {
    expect(
      identifierKey(TEST_KEY, {
        environmentId: SANDBOX,
        kind: kind,
        input: 'synthetic-input',
      }),
    ).toBe(expected);
  });

  it.each([
    ['browser-fingerprint', 'bf6793c5bf4c2bee6563db795a697c9eb27bb1ae20e12effcaf835e26983ff2e'],
    ['device-class', '83cd2f721b69d2a34bff77d3119937d68887326d4826157ebd97e7043368e526'],
    ['android-id', '4865d3092fda1eae28b932964223214f700ff419364daeddc883ade90177256f'],
  ] as const)('matches the OpenSSL vector for %s', (kind, expected) => {
    expect(identifierKey(TEST_KEY, { environmentId: SANDBOX, kind, input: INPUT })).toBe(expected);
  });

  it('keys each environment apart, and each kind apart for one input', () => {
    const sandbox = identifierKey(TEST_KEY, {
      environmentId: SANDBOX,
      kind: 'browser-fingerprint',
      input: INPUT,
    });

    expect(
      identifierKey(TEST_KEY, {
        environmentId: PRODUCTION,
        kind: 'browser-fingerprint',
        input: INPUT,
      }),
    ).not.toBe(sandbox);
    expect(
      identifierKey(TEST_KEY, { environmentId: SANDBOX, kind: 'device-class', input: INPUT }),
    ).not.toBe(sandbox);
    expect(sandbox).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a short key and a missing environment, echoing neither', () => {
    expect(() =>
      identifierKey(new Uint8Array(16), {
        environmentId: SANDBOX,
        kind: 'android-id',
        input: INPUT,
      }),
    ).toThrow(BlindIndexKeyError);
    expect(() =>
      identifierKey(TEST_KEY, { environmentId: ' ', kind: 'android-id', input: INPUT }),
    ).toThrow(TypeError);
  });
});

describe('blindIndexKeyId (C94.4, P09)', () => {
  it('is the 11-character base64url id of the key, as the OpenSSL vector gives', () => {
    expect(BLIND_INDEX_KEY_ID_LABEL).toBe('openverify/blind-index-key-id/v1');
    expect(blindIndexKeyId(TEST_KEY)).toBe('7JYJK10Twfg');
  });

  it('changes with the key and refuses a short one', () => {
    expect(blindIndexKeyId(new Uint8Array(32).fill(7))).not.toBe(blindIndexKeyId(TEST_KEY));
    expect(blindIndexKeyId(new Uint8Array(32).fill(7))).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(() => blindIndexKeyId(new Uint8Array(31))).toThrow(BlindIndexKeyError);
  });
});
