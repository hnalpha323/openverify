/**
 * C54.1, C53.6: what canceling a `business-website` verification does to its sub-resources:
 * nothing. It has none: no challenge, capture or file, and the site is never fetched. Its entered
 * URL (`verification_inputs`) is the attempt's evidence and stays, under the inquiry's retention
 * and redaction; it never reaches the flow API.
 */
import { noSubResources } from './stub.js';

export const businessWebsiteSubResources = noSubResources();
