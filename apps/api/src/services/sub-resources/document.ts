/**
 * C54.1: canceling a `document` verification (the inquiry's expiry or actions) touches no
 * sub-resource (`api-document`): a document has none. Its upload stays with the verification, as a
 * canceled government ID's photos do, until redaction or retention deletes it (C53.6); only
 * `initiated` verifications are canceled, so no extraction or preview exists yet (the job writes
 * both when it decides).
 */
import { noSubResources } from './stub.js';

export const documentSubResources = noSubResources();
