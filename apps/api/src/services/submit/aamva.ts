/**
 * C52.6, C54.1, C59.6: the `aamva` submit. The form source needs its entered values first (409
 * `inputs_required`); the silent source is never submitted by the client (409
 * `verification_created_by_server`): the worker creates and submits its attempts from the
 * government ID decisions (`jobs/types/aamva.ts`).
 */
import { aamvaSubmitGuard } from './stub.js';

export const aamvaSubmit = aamvaSubmitGuard();
