/**
 * Status badges of the lifecycle resources: inquiry sessions, accounts, templates and template
 * versions. The label always carries the meaning; colour only reinforces it.
 */
import type {
  AccountStatus,
  InquirySessionStatus,
  InquiryTemplateStatus,
  InquiryTemplateVersionStatus,
} from '@openverify/contracts';
import { Badge, type BadgeTone } from '../status-badge';

type Tone = Exclude<BadgeTone, 'danger'>;

const SESSION: Record<InquirySessionStatus, readonly [string, Tone]> = {
  active: ['Active', 'progress'],
  expired: ['Expired', 'neutral'],
  canceled: ['Canceled', 'neutral'],
};

export function SessionStatusBadge({ status }: { readonly status: InquirySessionStatus }) {
  const [label, tone] = SESSION[status];
  return <Badge status={status} label={label} tone={tone} />;
}

const ACCOUNT: Record<AccountStatus, readonly [string, Tone]> = {
  active: ['Active', 'success'],
  archived: ['Archived', 'neutral'],
};

export function AccountStatusBadge({ status }: { readonly status: AccountStatus }) {
  const [label, tone] = ACCOUNT[status];
  return <Badge status={status} label={label} tone={tone} />;
}

const TEMPLATE: Record<InquiryTemplateStatus, readonly [string, Tone]> = {
  active: ['Active', 'success'],
  archived: ['Archived', 'neutral'],
};

export function TemplateStatusBadge({ status }: { readonly status: InquiryTemplateStatus }) {
  const [label, tone] = TEMPLATE[status];
  return <Badge status={status} label={label} tone={tone} />;
}

const VERSION: Record<InquiryTemplateVersionStatus, readonly [string, Tone]> = {
  draft: ['Draft', 'attention'],
  published: ['Published', 'success'],
  superseded: ['Superseded', 'neutral'],
};

export function VersionStatusBadge({ status }: { readonly status: InquiryTemplateVersionStatus }) {
  const [label, tone] = VERSION[status];
  return <Badge status={status} label={label} tone={tone} />;
}
