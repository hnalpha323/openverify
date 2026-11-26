import type { GraphQueryResource } from '@openverify/contracts';
import type { GraphQueryStatus } from '@openverify/core';
import { useId } from 'react';
import { MaskedValue } from '../masked-value';
import { Badge, type BadgeTone } from '../status-badge';
import { Timestamp } from '../timestamp';
import { GRAPH_STATUS_WORDS, truncationSentences } from './graph-words';

export interface GraphResultSummaryProps {
  readonly query: GraphQueryResource;
  /** The pinned version's node limit, when it was read. */
  readonly nodeLimit: number | null;
  readonly piiView: boolean;
}

const STATUS_TONES: Readonly<Record<GraphQueryStatus, BadgeTone>> = Object.freeze({
  submitted: 'progress',
  completed: 'neutral',
  errored: 'attention',
  cancelled: 'neutral',
  timed_out: 'attention',
});

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The badge of a query's status, its label in words. */
export function GraphQueryStatusBadge({ status }: { readonly status: GraphQueryStatus }) {
  return (
    <Badge status={status} label={GRAPH_STATUS_WORDS[status].label} tone={STATUS_TONES[status]} />
  );
}

/**
 * A stored result's status and what it means, its counts, its parameters by name (each value
 * masked for a principal without `pii:view`, as the API serves them), and in words what the index
 * lacked and the caps cut (C102.4, H10). Nothing here passes or fails anyone.
 */
export function GraphResultSummary({ query, nodeLimit, piiView }: GraphResultSummaryProps) {
  const parametersId = useId();
  const noteId = useId();
  const { attributes } = query;
  const status = attributes.status;
  const accounts = attributes.nodes.filter((node) => node.type === 'account').length;
  const values = attributes.nodes.length - accounts;
  const redacted = attributes['redacted-at'];
  const sentences = truncationSentences({ ...attributes, nodeLimit });
  const parameters = Object.entries(attributes.params ?? {});

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <GraphQueryStatusBadge status={status} />
        <span>{GRAPH_STATUS_WORDS[status].description}</span>
      </p>
      {redacted === null ? (
        <p className="text-sm">
          {status === 'submitted'
            ? 'No result yet.'
            : `${plural(accounts, 'account', 'accounts')} and ${plural(values, 'shared value', 'shared values')}`}
        </p>
      ) : (
        <p className="text-sm">
          This result was redacted on <Timestamp value={redacted} /> (UTC): its nodes, links and
          parameters are gone.
        </p>
      )}
      {redacted === null && parameters.length > 0 && (
        <div role="group" aria-labelledby={parametersId} className="flex flex-col gap-1">
          <h3 id={parametersId} className="text-sm font-medium text-ink">
            Parameters
          </h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {parameters.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="font-mono text-xs text-ink-muted">{name}</dt>
                <dd className="break-all">
                  <MaskedValue value={value} masked={!piiView} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {sentences.length > 0 && (
        <div
          role="note"
          aria-labelledby={noteId}
          className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p id={noteId} className="font-medium">
            What this result may not show
          </p>
          <ul className="mt-1 list-disc ps-5">
            {sentences.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
