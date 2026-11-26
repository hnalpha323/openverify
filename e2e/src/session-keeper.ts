/**
 * One dashboard session per seeded operator for the whole full-stack run (Workflow 5C review
 * P021). The API counts every sign-in attempt, successful or not, against fixed 15-minute
 * windows of 10 per email and 50 per address (C4), and every spec signs in from 127.0.0.1, so a
 * suite that signs in per test exceeds the limit when run whole. A kept session is reused while
 * the API still accepts it, and moved back into the environment it was signed into when a spec
 * switched it; a session the API refuses (signed out, expired) is replaced by a new sign-in.
 */

/** A dashboard user session: its `ovu_` token and the environment the sign-in opened. */
export interface KeptSession {
  readonly token: string;
  readonly environmentId: string;
}

export interface SessionKeeperPorts {
  /** The session's current environment, or `null` when the API no longer accepts the token. */
  readonly currentEnvironment: (token: string) => Promise<string | null>;
  /** Moves the session into `environmentId` (`PUT /sessions/current/environment`). */
  readonly switchEnvironment: (token: string, environmentId: string) => Promise<void>;
}

export interface SessionKeeper<Role extends string> {
  /**
   * The kept session of `role`, or a new one from `signIn` (one counted sign-in attempt) when
   * none is kept or the API refuses the kept one.
   */
  session(role: Role, signIn: () => Promise<KeptSession>): Promise<KeptSession>;
}

export function createSessionKeeper<Role extends string>(
  ports: SessionKeeperPorts,
): SessionKeeper<Role> {
  /** Each role's session, or the sign-in or check under way, so two calls share one attempt. */
  const kept = new Map<Role, Promise<KeptSession>>();

  async function reuse(
    held: KeptSession,
    signIn: () => Promise<KeptSession>,
  ): Promise<KeptSession> {
    const environment = await ports.currentEnvironment(held.token);
    if (environment === null) {
      return signIn();
    }
    if (environment !== held.environmentId) {
      await ports.switchEnvironment(held.token, held.environmentId);
    }
    return held;
  }

  return {
    session(role, signIn) {
      const previous = kept.get(role);
      const next =
        previous === undefined
          ? signIn()
          : previous.then(
              (held) => reuse(held, signIn),
              () => signIn(),
            );
      kept.set(role, next);
      // A failed sign-in or check is not kept: the next call starts again.
      next.catch(() => {
        if (kept.get(role) === next) {
          kept.delete(role);
        }
      });
      return next;
    },
  };
}
