# Events and workflows

## Events

Each Connect event is delivered to webhooks like any other event (signed, filtered, masked; [webhooks](../settings/webhooks.md)), and its payload is the resource as the receiving side sees it ([share tokens](share-tokens.md)), never shared data. Each has a committed sample under `contracts/fixtures/api/connect/` and its words in the console (the `Connect` group).

| Event | Where | Origin |
|---|---|---|
| `connect/share-token.outbound-created` | the source environment | the source API's |
| `connect/share-token.inbound-created` | the destination environment of the same kind | the source API's |
| `connect/share-token.outbound-redeemed` | the source environment | the source API's |
| `connect/share-token.inbound-redeemed` | the destination environment | the source API's |
| `connect/share-token.expired` | both sides | ours |
| `connect/share-token.failed` | both sides | ours |
| `connect/share-token.consent-withdrawn` | the counterparty of a redeemed share | ours |
| `connect/share-token.source-redacted` | the destination of a redeemed share whose source was redacted later (advisory only) | ours |
| `connect/connection.created` | every environment of both organisations | ours |
| `connect/connection.activated` | every environment of both organisations | ours |
| `connect/connection.deactivated` | every environment of both organisations | ours |
| `connect/connection.reactivated` | every environment of both organisations | ours |
| `connect/connection.share-policy-changed` | every environment of both organisations | ours |
| `consent-record.created` | the record's environment | ours |
| `consent-record.declined` | the record's environment | ours |
| `consent-record.withdrawn` | the record's environment | ours |

- **Ours** (reason: each tells an operator about a change it must act on, which the source API's four events do not cover: an ended or failed share, a withdrawal or a redaction on the other side, a connection's state, a consent record).
- `connect/share-token.ready` is not emitted: no copy is prefetched ([limits](limits.md)).
- `inbound-created` tells the destination that a share exists. It carries no shared data; the data moves only on redemption.
- A cloned row stages no `verification.*` or check event: the destination learns of clones through `connect/share-token.inbound-redeemed` and its `redeem-summary`, and an `inquiry.*` event about a cloned inquiry carries `provenance`.
- A counterparty's event and audit entry name only `{organization-id, kind}`, never the other controller's staff.

## Workflow actions

Three actions (generated reference: [actions](../workflows/actions.md), [errors](../workflows/errors.md)):

| Action | Input | Scope |
|---|---|---|
| `create_share_token` | `connection-id`, `source-id`, `consent-record-id`, optional `expires-in-seconds` | `connect-share-tokens:write` |
| `redeem_share_token` | `share-token-id` and the redeem body ([peek and redeem](peek-and-redeem.md)) | `connect-share-tokens:redeem` |
| `expire_share_token` | `share-token-id` | `connect-share-tokens:write` |

Each is internal and exactly once (idempotent by its run step), with the workflow run as the audit actor (the token's `creator` is `{type: workflow-run, id: wfr_…}`). **Ours:** none is retried by default, none checks its causing principal (an `inbound-created` event in the destination is caused by the other organisation, whose principal the destination never sees), and none is marked irreversible (a created token can be expired; a redemption's copy is the destination's to redact).

**Not actions** (ours, reason: each is a person's or the operator backend's act): activating a connection, creating or attesting a consent record, withdrawing one.

## Triggers

An event trigger (`trigger-event`, [triggers](../workflows/triggers.md)) can listen to any of the events above. Three patterns:

- `connect/share-token.inbound-created`: the destination redeems on arrival (the source API's pattern). An automatic redemption still needs a valid destination-side consent record.
- `consent-record.withdrawn` and `connect/share-token.consent-withdrawn`: either side acts on a withdrawal, for example by opening a case to redact its copy.
