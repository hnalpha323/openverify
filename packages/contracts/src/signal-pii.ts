/**
 * C107.5 (P07): the PII attribute names of Workflow 7A's resources and request bodies: the
 * inquiry session (its address, user agent and location), the network row and the device's
 * fingerprints, and the handoff destination. The API's masking
 * lists and the stored API-log masked set consume it, and the collision test keeps every name PII
 * at every resource.
 */
import { PII_DEVICE_ATTRIBUTES } from './devices.js';
import { PII_HANDOFF_ATTRIBUTES } from './handoffs.js';
import { PII_INQUIRY_SESSION_ATTRIBUTES } from './inquiry-sessions.js';
import { PII_NETWORK_ATTRIBUTES } from './networks.js';

export const PII_SIGNAL_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set([
    ...PII_INQUIRY_SESSION_ATTRIBUTES,
    ...PII_NETWORK_ATTRIBUTES,
    ...PII_DEVICE_ATTRIBUTES,
    ...PII_HANDOFF_ATTRIBUTES,
  ]),
]);
