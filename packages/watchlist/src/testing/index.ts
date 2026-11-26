/**
 * `@openverify/watchlist/testing` (plan C77.5, C78.8): synthetic lists in each publisher's format
 * and in the normalised import format, the sandbox lists `openverify-sandbox` and
 * `openverify-sandbox-pep`, synthetic SPARQL answers with fictional QIDs, the held-out generator
 * (`held-out/`, which `watchlist-matcher` never reads) and the stub answers of GDELT, HIBP, Twilio
 * Lookup and Smarty. Owned by `fixtures-6` (Workflow 6A Stage 2).
 *
 * Everything here is generated from a seed: fictional people, companies, vessels, addresses,
 * identifiers and crypto addresses, never a real listed person, PEP or publisher entry (C89.1).
 */

/** The area this entry point holds. */
export const WATCHLIST_TESTING_AREA = 'testing';

export * from './random.js';
export * from './names.js';
export * from './identifiers.js';
export * from './crypto-addresses.js';
export * from './records.js';
export * from './normalised.js';
export * from './peps.js';
export * from './sandbox.js';
export * from './fixture-files.js';
export * from './formats/xml.js';
export * from './formats/zip.js';
export * from './formats/countries.js';
export * from './formats/ofac.js';
export * from './formats/eu.js';
export * from './formats/uk.js';
export * from './formats/un.js';
export * from './stub-answer.js';
export * from './sparql.js';
export * from './providers/gdelt.js';
export * from './providers/hibp.js';
export * from './providers/twilio-lookup.js';
export * from './providers/smarty.js';
export * from './heavy-headed.js';
