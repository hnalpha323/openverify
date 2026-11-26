import { createHash } from 'node:crypto';

/**
 * SHA-256 of a session token (`ovs_...` flow sessions, `ovu_...` dashboard sessions) as
 * lowercase hex. C1 stores only this hash; look sessions up by it.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
