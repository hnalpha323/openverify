/**
 * `@openverify/emrtd/testing`: synthetic chips for the tests, the dev seed and the e2e run (plan
 * C65.3). Keys come from fixed seeds (EC as `seed mod n`; RSA from a seeded prime search, at most
 * 2,048 bits for DSC and AA keys and one 3,072-bit CSCA, memoised per seed), ECDSA signatures are
 * RFC 6979 through `@noble/curves`, and every builder takes the `now` it builds around. Nothing
 * here is real chip data, and no key file is ever committed.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) fixed these names; `emrtd` (Stage 2) builds them and may
 * add options. `api-nfc` builds the seed's Utopia CSCA and CRL and the e2e chip with them.
 */

export {
  TEST_CURVES,
  seededBytes,
  testKeyPair,
  testSign,
  testSignDigest,
  testSignatureAlgorithm,
  type TestCurve,
  type TestKeyPair,
  type TestKeySpec,
  type TestSignature,
  type TestSignatureScheme,
} from './keys.js';
export {
  TEST_CHIP_VARIANTS,
  buildChip,
  signActiveAuthentication,
  type TestChip,
  type TestChipOptions,
  type TestChipVariant,
} from './chip.js';
export {
  TEST_MASTER_LIST_VARIANTS,
  buildMasterList,
  type TestMasterListOptions,
  type TestMasterListVariant,
} from './master-list.js';
export {
  buildCrl,
  buildCsca,
  buildDsc,
  buildLinkCertificate,
  type TestCertificate,
  type TestCertificateOverrides,
  type TestCrlOptions,
  type TestCscaOptions,
  type TestDscOptions,
  type TestExtension,
} from './x509.js';

/** The subpath this module is published under. */
export const TESTING_ENTRY = '@openverify/emrtd/testing';

export {
  UTOPIA,
  UTOPIA_CSCA_SEED,
  buildUtopiaChip,
  buildUtopiaCrl,
  buildUtopiaCsca,
  testTrustStore,
  type UtopiaChip,
  type UtopiaChipOptions,
} from './utopia.js';
