'use client';

import type { WebhookDeliveryResource } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useId, useRef, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import { DeliveriesTable } from './webhook-tables';

export interface DeliverySearchFound {
  readonly deliveries: readonly WebhookDeliveryResource[];
  readonly next: string | null;
}

export interface DeliverySearchProps {
  readonly action: (
    previous: ActionState<DeliverySearchFound>,
    formData: FormData,
  ) => Promise<ActionResult<DeliverySearchFound>>;
}

const MAX_CONDITIONS = 20;

const ATTRIBUTES = [
  { value: 'status', label: 'Status', hint: 'pending, succeeded or failed' },
  { value: 'event_name', label: 'Event name', hint: 'such as inquiry.approved' },
  { value: 'webhook_id', label: 'Webhook ID', hint: 'wbh_…' },
  { value: 'updated_at', label: 'Updated (UTC)', hint: 'a date and time' },
] as const;

const OPERATORS: Readonly<Record<string, readonly { value: string; label: string }[]>> = {
  updated_at: [
    { value: 'gte', label: 'at or after' },
    { value: 'gt', label: 'after' },
    { value: 'lt', label: 'before' },
    { value: 'lte', label: 'at or before' },
  ],
  list: [
    { value: 'eq', label: 'equals' },
    { value: 'in', label: 'is one of (commas)' },
  ],
};

interface Condition {
  readonly key: number;
  readonly attribute: string;
}

/**
 * C165.4: the delivery search builder. Each condition is an attribute, "is" or "is not", an
 * operator and a value, joined by "all of" or "any of" (the API's `and`, `or` and `not`, at most two
 * levels and 20 conditions). Every control is a native field, so the builder works by keyboard; the
 * result count is announced politely and the next page is posted with the last delivery's id.
 */
export function DeliverySearch({ action }: DeliverySearchProps) {
  const id = useId();
  const counter = useRef(1);
  const [conditions, setConditions] = useState<Condition[]>([{ key: 0, attribute: 'status' }]);
  const [found, setFound] = useState<DeliverySearchFound | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const search = useFormAction(action, { onSuccess: setFound });
  const summary =
    found === null
      ? ''
      : `${String(found.deliveries.length)} ${found.deliveries.length === 1 ? 'delivery' : 'deliveries'} on this page, newest first.${found.next === null ? '' : ' More match.'}`;
  return (
    <div className="flex flex-col gap-4">
      <form
        ref={form}
        role="search"
        aria-label="Search webhook deliveries"
        {...search.formProps}
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:max-w-xs">
          Match
          <select name="combine" defaultValue="and" className={controlClassName({})}>
            <option value="and">all</option>
            <option value="or">any</option>
          </select>
        </label>
        <ol className="flex flex-col gap-3">
          {conditions.map((condition, index) => {
            const number = String(index + 1);
            const attribute = ATTRIBUTES.find((each) => each.value === condition.attribute);
            const operators =
              OPERATORS[condition.attribute === 'updated_at' ? 'updated_at' : 'list'];
            return (
              <li key={condition.key} className="flex flex-wrap items-end gap-2">
                <select
                  name="clause-attribute"
                  aria-label={`Condition ${number} attribute`}
                  value={condition.attribute}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setConditions((all) =>
                      all.map((each) =>
                        each.key === condition.key ? { ...each, attribute: next } : each,
                      ),
                    );
                  }}
                  className={controlClassName({})}
                >
                  {ATTRIBUTES.map((each) => (
                    <option key={each.value} value={each.value}>
                      {each.label}
                    </option>
                  ))}
                </select>
                <select
                  name="clause-negate"
                  aria-label={`Condition ${number} is or is not`}
                  defaultValue="is"
                  className={controlClassName({})}
                >
                  <option value="is">is</option>
                  <option value="is-not">is not</option>
                </select>
                <select
                  name="clause-operator"
                  aria-label={`Condition ${number} operator`}
                  key={`${String(condition.key)}-${condition.attribute}`}
                  className={controlClassName({})}
                >
                  {operators?.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
                <input
                  name="clause-value"
                  aria-label={`Condition ${number} value`}
                  aria-describedby={`${id}-hint-${String(condition.key)}`}
                  type={condition.attribute === 'updated_at' ? 'datetime-local' : 'text'}
                  spellCheck={false}
                  className={controlClassName({})}
                />
                <span id={`${id}-hint-${String(condition.key)}`} className="text-sm text-ink-muted">
                  {attribute?.hint}
                </span>
                {conditions.length > 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Remove condition ${number}`}
                    onClick={() => {
                      setConditions((all) => all.filter((each) => each.key !== condition.key));
                    }}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={conditions.length >= MAX_CONDITIONS}
            onClick={() => {
              const key = counter.current;
              counter.current += 1;
              setConditions((all) => [...all, { key, attribute: 'status' }]);
            }}
          >
            Add a condition
          </Button>
          <Button type="submit" disabled={search.pending}>
            {search.pending ? 'Searching…' : 'Search'}
          </Button>
        </div>
        <ProblemDisplay problem={search.problem} />
      </form>
      <p role="status" className="text-sm text-ink-muted">
        {summary}
      </p>
      {found !== null && (
        <>
          <DeliveriesTable
            deliveries={found.deliveries}
            caption="Deliveries found"
            emptyMessage="No delivery matches."
            byWebhook
          />
          {found.next !== null && (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (form.current === null || found.next === null) {
                    return;
                  }
                  const data = new FormData(form.current);
                  data.set('after', found.next);
                  search.submit(data);
                }}
              >
                Next page
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
