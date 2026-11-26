/**
 * C108: the signals of an account's latest inquiries, in words, one row per signal, each inquiry
 * linked. An inquiry whose signals are not computed yet says so; a `null` value reads "Not
 * evaluated" with its reason (ADR 0006). The DB-IP line follows when an IP location or a distance
 * from one shows (C92.8).
 */
import type { InquiryResource, SignalDetail } from '@openverify/contracts';
import Link from 'next/link';
import { SIGNAL_LABELS, signalValueText } from '../../lib/signal-words';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { DbIpAttribution } from './db-ip-attribution';
import { EvidenceMeta } from './evidence';

/** How many of the account's inquiries the section reads, newest first. */
export const ACCOUNT_SIGNAL_INQUIRIES = 5;

interface Row {
  readonly key: string;
  readonly inquiryId: string;
  readonly name: string | null;
  readonly text: string;
  readonly detail: SignalDetail | undefined;
}

const IP_LOCATION_SIGNALS: ReadonlySet<string> = new Set([
  'inquiry/country_from_session',
  'inquiry/country_comparison',
  'inquiry/max_session_distance',
]);

const labelOf = (name: string) =>
  Object.hasOwn(SIGNAL_LABELS, name) ? SIGNAL_LABELS[name as keyof typeof SIGNAL_LABELS] : name;

function rowsOf(inquiry: InquiryResource): Row[] {
  const { signals, 'signal-details': details } = inquiry.attributes;
  if (signals === undefined || details === undefined) {
    return [
      {
        key: `${inquiry.id}-none`,
        inquiryId: inquiry.id,
        name: null,
        text: 'This server serves no signals',
        detail: undefined,
      },
    ];
  }
  if (details['computed-at'] === null) {
    return [
      {
        key: `${inquiry.id}-pending`,
        inquiryId: inquiry.id,
        name: null,
        text: 'Not computed yet',
        detail: undefined,
      },
    ];
  }
  return signals.map(({ name, value }) => {
    const detail = details[name] as SignalDetail | undefined;
    return {
      key: `${inquiry.id}-${name}`,
      inquiryId: inquiry.id,
      name,
      text: signalValueText(name, value, detail),
      detail,
    };
  });
}

const COLUMNS: readonly Column<Row>[] = [
  {
    id: 'inquiry',
    header: 'Inquiry',
    cell: (row) => (
      <Link href={`/inquiries/${row.inquiryId}`} className={LINK_CLASS}>
        <code className="font-mono text-xs">{row.inquiryId}</code>
      </Link>
    ),
  },
  {
    id: 'signal',
    header: 'Signal',
    rowHeader: true,
    cell: (row) => (row.name === null ? 'Signals' : labelOf(row.name)),
  },
  { id: 'value', header: 'Value', cell: (row) => row.text },
  {
    id: 'evidence',
    header: 'Evidence',
    cell: (row) =>
      row.detail === undefined ? null : (
        <EvidenceMeta
          tier={row.detail.tier}
          beta={row.detail.stage === 'beta'}
          confidence={'confidence' in row.detail ? row.detail.confidence : null}
        />
      ),
  },
];

export function AccountSignals({ inquiries }: { readonly inquiries: readonly InquiryResource[] }) {
  if (inquiries.length === 0) {
    return <p className="text-sm text-ink-muted">This account has no inquiry yet.</p>;
  }
  const latest = inquiries.slice(0, ACCOUNT_SIGNAL_INQUIRIES);
  const rows = latest.flatMap(rowsOf);
  const showsIpLocation = latest.some((inquiry) =>
    (inquiry.attributes.signals ?? []).some(
      (signal) => signal.value !== null && IP_LOCATION_SIGNALS.has(signal.name),
    ),
  );
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption="Signals of the latest inquiries"
        captionHidden
        columns={COLUMNS}
        rows={rows}
        getRowKey={(row) => row.key}
        emptyMessage="No signals."
      />
      {showsIpLocation && <DbIpAttribution />}
    </div>
  );
}
