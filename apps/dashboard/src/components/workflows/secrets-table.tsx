import type { WorkflowSecretResource } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { DataTable } from '../data-table';
import { Timestamp } from '../timestamp';
import { DeleteSecretButton, EditSecretButton, SecretValueButton } from './secret-forms';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** What changes a row offers: `undefined` without `secrets:write`. */
export interface SecretRowActions {
  readonly setValue: Action;
  readonly remove: Action;
  /** C125.2: the description, hosts and placements. */
  readonly edit?: Action;
}

/** Where a value may stand in a request (C125.1, P29), in words. */
function placementsOf(placements: WorkflowSecretResource['attributes']['allowed-placements']) {
  const headers = placements.headers.length === 0 ? 'none' : placements.headers.join(', ');
  const pointers =
    placements['body-pointers'].length === 0 ? 'none' : placements['body-pointers'].join(', ');
  return `Headers: ${headers}. Body: ${pointers}.`;
}

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

function valueOf(value: WorkflowSecretResource['attributes']['environment-value']) {
  if (value === null) {
    return 'No value in this environment';
  }
  return (
    <>
      <span>{`Ends in ${value.last4} (version ${String(value.version)})`}</span>
      {value['rotated-at'] !== null && (
        <span className="block text-xs">
          Rotated <Timestamp value={value['rotated-at']} />
        </span>
      )}
      {value['previous-expires-at'] !== null && (
        <span className="block text-xs">
          The previous value verifies until <Timestamp value={value['previous-expires-at']} />
        </span>
      )}
    </>
  );
}

/**
 * The environment's workflow secrets (C125, C141.7): each key with its description, its allowed
 * hosts and this environment's value as metadata only (the last four characters and the version);
 * the API serves nothing more, so nothing more reaches the browser.
 */
export function SecretsTable({
  secrets,
  actions,
}: {
  readonly secrets: readonly WorkflowSecretResource[];
  readonly actions: SecretRowActions | undefined;
}) {
  return (
    <DataTable
      caption="Secrets"
      captionHidden
      rows={secrets}
      getRowKey={(secret) => secret.id}
      emptyMessage="No secret yet."
      columns={[
        {
          id: 'key',
          header: 'Key',
          rowHeader: true,
          cell: (secret) => code(secret.attributes.key),
        },
        {
          id: 'description',
          header: 'Description',
          cell: (secret) => secret.attributes.description ?? 'None',
        },
        {
          id: 'hosts',
          header: 'Allowed hosts',
          cell: (secret) => secret.attributes['allowed-hosts'].join(', '),
        },
        {
          id: 'placements',
          header: 'May stand in',
          cell: (secret) => placementsOf(secret.attributes['allowed-placements']),
        },
        {
          id: 'value',
          header: 'Value in this environment',
          cell: (secret) => valueOf(secret.attributes['environment-value']),
        },
        ...(actions === undefined
          ? []
          : [
              {
                id: 'actions',
                header: 'Actions',
                cell: (secret: WorkflowSecretResource) => (
                  <div className="flex flex-wrap gap-2">
                    {actions.edit !== undefined && (
                      <EditSecretButton
                        secretKey={secret.attributes.key}
                        description={secret.attributes.description}
                        hosts={secret.attributes['allowed-hosts']}
                        headers={secret.attributes['allowed-placements'].headers}
                        bodyPointers={secret.attributes['allowed-placements']['body-pointers']}
                        action={actions.edit}
                      />
                    )}
                    <SecretValueButton
                      secretKey={secret.attributes.key}
                      hasValue={secret.attributes['environment-value'] !== null}
                      action={actions.setValue}
                    />
                    <DeleteSecretButton secretKey={secret.attributes.key} action={actions.remove} />
                  </div>
                ),
              },
            ]),
      ]}
    />
  );
}
