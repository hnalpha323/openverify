/**
 * How a connection is named and its policy version said (C242.1), shared by the list and the
 * connection's page. A module client components may import.
 */
import type { ConnectionResource } from '@openverify/contracts';

/** Review P09: the source is not told the destination's name before the first activation. */
export const DESTINATION_NAME_PENDING = 'Named once the destination activates';
export const SELF_CONNECTION_NAME = 'This organization (self-connection)';

/** The other organisation, as the caller's side reads it. */
export function counterpartyName(connection: ConnectionResource): string {
  const { attributes } = connection;
  switch (attributes.direction) {
    case 'inbound':
      return attributes['source-organization-name'];
    case 'outbound':
      return attributes['destination-organization-name'] ?? DESTINATION_NAME_PENDING;
    case 'self':
      return SELF_CONNECTION_NAME;
  }
}

/** "Version 2", "Version 2, not accepted yet" or "Version 3, version 2 accepted". */
export function policyVersionWords(connection: ConnectionResource): string {
  const version = connection.attributes['share-policy'].version;
  const accepted = connection.attributes['accepted-policy-version'];
  const current = `Version ${String(version)}`;
  if (accepted === version) {
    return current;
  }
  return accepted === null
    ? `${current}, not accepted yet`
    : `${current}, version ${String(accepted)} accepted`;
}

/**
 * C244.4: the names `seed:dev --connect` gives its sample partner (`apps/api/src/seed/connect-seed.ts`:
 * the organisation "Example Partner", shown as "Example Partner (sample)"). The API serves no flag
 * that marks a seeded organisation, so the console reads the seed's names (contractDeviation).
 */
export const SAMPLE_PARTNER_NAMES: readonly string[] = Object.freeze([
  'Example Partner',
  'Example Partner (sample)',
]);

/** C244.4: whether `name` is the sample partner a development install seeds. */
export function isSamplePartner(name: string | null): boolean {
  return name !== null && SAMPLE_PARTNER_NAMES.includes(name);
}

/** The counterparty's name, and whether it is the seeded sample. */
export function counterpartyOf(connection: ConnectionResource): {
  readonly name: string;
  readonly sample: boolean;
} {
  const { attributes } = connection;
  const named =
    attributes.direction === 'inbound'
      ? attributes['source-organization-name']
      : attributes.direction === 'outbound'
        ? attributes['destination-organization-name']
        : null;
  return { name: counterpartyName(connection), sample: isSamplePartner(named) };
}
