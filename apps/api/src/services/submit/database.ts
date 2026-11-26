/**
 * C52.6, C54.1: the `database` submit: the body carries no type member, and the values must have
 * been entered first (`POST /verifications/:id/inputs`, else 409 `inputs_required`). The inputs
 * route already refused a body without the step's required members (C52.3), so entered values
 * are complete; the job judges them (`jobs/types/database.ts`).
 */
import { standardSubmitGuard } from './standard.js';

export const databaseSubmit = standardSubmitGuard({ inputs: true });
