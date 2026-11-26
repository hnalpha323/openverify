/**
 * C125.3-C125.5: a step's secrets, resolved last, inside the action. Where a reference stands is
 * checked again at run time (publish checked it, and a secret's hosts and placements can have changed
 * since): a header it may go in, a body pointer it may go at, the literal host it is bound to, and at
 * most once per request. Every refusal is `secret_placement_refused` and names no value, and a key
 * with no value here is the same refusal: nothing may go out without it.
 */
import { getWorkflowSecret, openWorkflowSecretValue, type WorkflowSecret } from '@openverify/db';
import { ActionStepError, type ActionContext } from '../../engine/action-port.js';
import { hostIsListed } from './hosts.js';

export type SecretPlacement =
  | { kind: 'header'; key: string; name: string }
  | { kind: 'body'; key: string; pointer: string }
  | { kind: 'signing'; key: string };

export interface OpenedSecret {
  key: string;
  value: string;
  previousValue: string | null;
}

const refused = (): ActionStepError => new ActionStepError('secret_placement_refused');

function allowedAt(secret: WorkflowSecret, placement: SecretPlacement): boolean {
  const placements = secret.allowedPlacements;
  switch (placement.kind) {
    case 'header':
      return placements.headers.some((name) => name.toLowerCase() === placement.name.toLowerCase());
    case 'body':
      return placements['body-pointers'].includes(placement.pointer);
    case 'signing':
      return true;
  }
}

/**
 * The secrets of `placements`, each checked first, every value opened after all of them passed.
 * @throws {ActionStepError} `secret_placement_refused`.
 */
export async function openStepSecrets(
  context: Pick<ActionContext, 'services' | 'environmentId' | 'organizationId' | 'now'>,
  host: string,
  placements: readonly SecretPlacement[],
): Promise<readonly OpenedSecret[]> {
  const { services, environmentId, organizationId, now } = context;
  const keys = placements.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw refused();
  }
  const secrets: WorkflowSecret[] = [];
  for (const placement of placements) {
    const secret = await getWorkflowSecret(services.db, organizationId, placement.key);
    if (
      secret === null ||
      !hostIsListed(host, secret.allowedHosts) ||
      !allowedAt(secret, placement)
    ) {
      throw refused();
    }
    secrets.push(secret);
  }
  const opened: OpenedSecret[] = [];
  for (const secret of secrets) {
    const value = await openWorkflowSecretValue(services.db, environmentId, secret.id, now);
    if (value === null) {
      throw refused();
    }
    opened.push({ key: secret.key, ...value });
  }
  return opened;
}
