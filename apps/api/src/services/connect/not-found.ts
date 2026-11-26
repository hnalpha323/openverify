/**
 * C232.8 (Workflow 11A Stage 1b (C)): the one 404 of Connect. Every refusal of a token, connection or
 * consent record the caller may not see (unknown, another organisation's, the other environment
 * kind's, a third party's), and every Connect route while the install switch is off (C231.10),
 * answers this body, built here and nowhere else: `CONNECT_NOT_FOUND_PROBLEM`
 * (`contracts/fixtures/problems/connect/not-found.json`), so two refusals differ only by their
 * `instance` and `requestId`. Placed by `foundation-11a`; every Connect agent calls it.
 */
import { CONNECT_NOT_FOUND_PROBLEM } from '@openverify/contracts';
import { NotFoundError } from '../../errors.js';

/** The one generic 404 (throw it). */
export const connectNotFound = (): NotFoundError =>
  new NotFoundError(CONNECT_NOT_FOUND_PROBLEM.detail);
