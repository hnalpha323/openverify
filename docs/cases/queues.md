# Queues and assignment

## Queues

A queue (`cqueue_`, `case-queues:write`) has a `name`, a `status` and `members[] { user-id, max-open (1 to 500, default 50), paused }`, at most 200, each user once; a member must be an active user of the organisation holding `cases:write` (`case_assignee_ineligible`). A case is in at most one queue, set by `case-queue-id` on create or `PATCH` (`null` removes it), which fires `case.queue-updated`. A queue names its assignment policy with `case-assignment-policy-id`; a queue with none leaves its cases to the pull and to manual assignment.

- **Archiving** (`PATCH` with `status: archived`) is permanent: its unassigned cases go back to no queue (a `queue-changed` history row with reason `queue-archived`), and nothing more is assigned from it.
- **Replacing the members** (`PUT /case-queues/:id/members`) gives a removed member's open cases of that queue back at once, in the same transaction: each is unassigned (`case.assigned` with `assignee-id: null`, reason `member-left`) and offered to the queue's policy again.

## Assignment policies

A policy (`cap_`) has a `distribution` (`round-robin`, `fewest-open`, `case-creator`, `inquiry-creator`), a `sort` (`created-at` or `sla-expires-at`), `agents` (user ids, or `null` for the members of the queue a case is routed to), `max-capacity` (or `null` for each member's own `max-open`) and `sources` (1 to 50 templates or queues, in priority order). A template version or a queue names its policy. A case entering a queue, or created on a template, with a policy is assigned at once when an agent is eligible, else it waits for a pull. A case already assigned is never reassigned on entry, and an archived queue assigns nobody.

An agent is eligible when, in this order: active, holding `cases:write`, able to see the template, not paused, and under capacity. Capacity is the lower of the member's `max-open` and the policy's `max-capacity`, so a policy never lifts a member's own limit; a listed user who is not a member has the default of 50. Open counts span the environment, every queue together (an approximation, decision 67).

- **round-robin:** under the queue's row lock (the policy's, for a case that enters no queue), the first eligible agent after the cursor in user-id order; the cursor moves. When nobody is eligible the cursor stays.
- **fewest-open:** the eligible agent with the fewest open assigned cases, ties to the least recently assigned, then the user id.
- **case-creator** and **inquiry-creator:** the user who created the case or its first held inquiry (read from that inquiry's creation audit entry), only when that user is an eligible agent; otherwise the case stays unassigned.

Every assignment writes the assignee, `assigned-at`, the assigner (`user`, `api-key`, `workflow-run`, or `case-assignment-policy` with the `cap_` id), a history row with the strategy and its inputs (the cursor, the eligible and candidate counts, open counts, ties; never a value), `case.assigned` and an in-app notification.

A policy also drains its `sources`: `case-assignment-drain` runs every 60 seconds and, for each policy that names sources, takes the waiting cases they hold (unassigned, open, unredacted) by the sources' priority, then the policy's `sort`, then age, and assigns each through the policy while an agent has room, with the same history row, `case.assigned` and notification as on entry. Each case is its own transaction, locking the case (`SKIP LOCKED`), then its queue and the policy before the open counts are read, so no case goes to two agents and no agent passes its capacity; a round-robin or fewest-open policy that places nobody stops its pass.

## Manual assignment and the pull

- `POST /cases/:id/assign` takes `meta.user-id` (`null` unassigns) or `meta.user-email-address` (resolved within the organisation), one of them, and `meta.lock-version`. Assigning anyone but oneself, or unassigning another user's case, needs `cases:assign`, checked before any lookup, so an address can never be probed. The target must be active, hold `cases:write` and see the template. The same assignee again is no change.
- `POST /cases/next` (`cases:write`, users only) takes the most urgent unassigned case of the caller's active queues (or of `meta.case-queue-ids`, each one the caller belongs to), `FOR UPDATE SKIP LOCKED`, ordered by `sla-expires-at` (none last), then `created-at`, then id, on a partial index; it applies template visibility, not capacity or pause, because pulling is the person's own choice. It answers `{ data: null }` when nothing waits.
- `POST /cases/bulk` with `assign` replaces existing assignees, through the manual rule.

## The re-assignment sweep

`case-reassign` runs every 60 seconds: open cases assigned to a user who was deactivated, lost `cases:write` or the template's visibility return to their queue's policy or to nobody, each with history (`unassigned`, reason `assignee-ineligible`) and `case.assigned`. Member rows of such users are kept; a policy reads eligibility live and never chooses them.
