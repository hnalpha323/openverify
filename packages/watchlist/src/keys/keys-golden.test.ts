/**
 * C78.3 (V04): the golden test of every derived column. The keys, normalised names, normalised
 * identifiers and canonical crypto addresses of fixed inputs hash to one digest per version of the
 * rules. A change to their output without a new version fails here; a new version adds its own
 * digest below and never edits an earlier one. Inputs are fictional or common names and the
 * synthetic or published values of the other tests.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CRYPTO_NORMALISER_VERSION, canonicaliseCryptoAddress } from '../crypto/index.js';
import { analyseBusinessName, analysePersonName } from '../names/index.js';
import { canonicalJson } from '../record/index.js';
import {
  IDENTIFIER_NORMALISER_VERSION,
  KEYS_VERSION,
  listNameKeys,
  normaliseIdentifier,
  queryNameKeys,
  variantGroupsFrom,
  type IdentifierKind,
} from './index.js';

/** One digest per `KEYS_VERSION;IDENTIFIER_NORMALISER_VERSION;CRYPTO_NORMALISER_VERSION`. */
const GOLDEN: Readonly<Record<string, string>> = {
  'names-1;identifiers-1;crypto-1':
    '9bf0bfe63d7da9fdd9238ac46b0d02cbc8b22228a2575ddbf9d57d89003f76b0',
  // Owner decision 1 after 6B: the token-pair keys.
  'names-2;identifiers-1;crypto-1':
    '97966ecbcc8d3131cd67300915b72cdce2cb73f62f8deb2525d8ebea61ed58d6',
};

const GROUPS = variantGroupsFrom(
  [
    ['Q1', ['ivan', 'иван', 'iwan']],
    ['Q2', ['maria', 'мария', 'marija']],
    ['Q3', ['abdulrahman', 'abd al rahman']],
  ],
  'f'.repeat(64),
);

const PERSONS = [
  'Hans Müller',
  'SMITH, John Paul',
  'Иван Петров',
  'Мария Щербакова',
  'محمد عبد الله',
  '王小明',
  'Abd al-Rahman bin Rashid',
  'Dr Jean-Luc de la Fontaine Jr',
  'Ołeksij Ćwik',
  'Ünal Øvergård',
];
const BUSINESSES = ['The Acme Trading Company Ltd', 'ООО Ромашка', 'I.B.M. Corp', 'Smith & Wesson'];
const IDENTIFIERS: readonly (readonly [IdentifierKind, string, string | null])[] = [
  ['passport', ' ab 123-456 ', 'gb'],
  ['lei', '5299000sandboxlei047', null],
  ['swift_bic', 'abcd gb 2l xxx', null],
  ['imo', 'IMO 9999993', null],
  ['mmsi', '123 456 789', null],
  ['website', 'https://www.Example.COM/path', null],
  ['email', ' Jane.Doe@Example.ORG ', null],
  ['registration_number', 'hrb-12 345', 'de'],
];
const CRYPTO = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
  '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
  'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
  'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
  'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  `4${'A'.repeat(94)}`,
  'not-a-known-address-format',
];

function outputs(): unknown {
  const names = [
    ...PERSONS.map((name) => analysePersonName(name)),
    ...BUSINESSES.map((name) => analyseBusinessName(name)),
  ];
  return {
    names: names.map((name) => [
      name.normalised,
      listNameKeys(name, GROUPS),
      queryNameKeys([name], GROUPS),
    ]),
    identifiers: IDENTIFIERS.map(([kind, value, country]) =>
      normaliseIdentifier(kind, value, country),
    ),
    crypto: CRYPTO.map((address) => canonicaliseCryptoAddress(address)),
  };
}

describe('the derived columns (V04)', () => {
  it('hash to the golden digest of the current rule versions', () => {
    const versions = [KEYS_VERSION, IDENTIFIER_NORMALISER_VERSION, CRYPTO_NORMALISER_VERSION];
    const digest = createHash('sha256').update(canonicalJson(outputs()), 'utf8').digest('hex');
    expect({ versions: versions.join(';'), digest }).toEqual({
      versions: versions.join(';'),
      digest: GOLDEN[versions.join(';')],
    });
  });
});
