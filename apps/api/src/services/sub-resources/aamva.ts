/**
 * C54.1, C53.6: what canceling an `aamva` verification does to its sub-resources: nothing.
 * It has none: no challenge, capture or file. Its entered or copied values (`verification_inputs`)
 * are the attempt's evidence and stay, under the inquiry's retention and redaction, as a canceled
 * attempt's files do; they never reach the flow API.
 */
import { noSubResources } from './stub.js';

export const aamvaSubResources = noSubResources();
