/**
 * P5-5 (Phase 5 carry-forward): Docker Desktop sometimes keeps a port reserved for a moment after
 * the container that held it is gone, so `compose up` fails with a port-allocation error although
 * the port was free when the harness chose it. The harness then takes the project down and runs
 * `up` once more before it fails the run. Any other failure fails the run at once.
 */
import { CommandError } from './processes.js';

/** Docker's words for a host port it cannot bind (the daemon's and Docker Desktop's). */
const PORT_ALLOCATION =
  /port is already allocated|ports are not available|bind: address already in use/iu;

/** Whether `error` is Docker's port-allocation refusal (and not any other failed `up`). */
export function isPortAllocationError(error: unknown): boolean {
  return error instanceof CommandError && PORT_ALLOCATION.test(error.message);
}

export interface ComposeUpSteps {
  up(): Promise<unknown>;
  down(): Promise<unknown>;
  /** Waits before the second `up`. */
  pause(): Promise<void>;
  log(message: string): void;
}

/** Runs `up`, and on a port-allocation error `down`, a pause and `up` once more. */
export async function composeUpWithRetry(steps: ComposeUpSteps): Promise<void> {
  try {
    await steps.up();
  } catch (error) {
    if (!isPortAllocationError(error)) {
      throw error;
    }
    steps.log(
      'compose up met a port-allocation error; taking the project down and trying once more',
    );
    await steps.down();
    await steps.pause();
    await steps.up();
  }
}
