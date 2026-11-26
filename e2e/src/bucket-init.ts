/**
 * KP11-68: the one-shot bucket init (`objectstore-init`) once exited non-zero while the e2e stack
 * started, and its own message was lost with the compose project. The harness now keeps the
 * init's output whenever it fails: written to `e2e/.artifacts/logs/objectstore-init.log` and its
 * end quoted in the error, before the project goes down.
 */

export interface BucketInitSteps {
  /** `docker compose wait objectstore-init`: rejects when the init exits non-zero. */
  wait(): Promise<unknown>;
  /** The init container's exit codes (`docker compose ps --all`). */
  exitCodes(): Promise<readonly (number | undefined)[]>;
  /** Writes the init's log to its file and returns the log's last lines. */
  saveLog(): Promise<string>;
}

/** Waits for the bucket init; on any failure keeps its log and names it in the error. */
export async function waitForBucketInit(steps: BucketInitSteps): Promise<void> {
  let failure: string | undefined;
  try {
    await steps.wait();
    const codes = await steps.exitCodes();
    if (codes.length === 0 || !codes.every((code) => code === 0)) {
      failure = `objectstore-init did not exit 0: exit codes ${JSON.stringify(codes)}`;
    }
  } catch (error) {
    failure = (error as Error).message;
  }
  if (failure === undefined) {
    return;
  }
  const kept = await steps.saveLog().then(
    (logTail) => `Its log (e2e/.artifacts/logs/objectstore-init.log) ends:\n${logTail}`,
    (error: unknown) => `Its log could not be kept: ${(error as Error).message}`,
  );
  throw new Error(`${failure}\n${kept}`);
}
