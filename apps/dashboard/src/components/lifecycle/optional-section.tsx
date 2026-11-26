import type { ReactNode } from 'react';
import { ForbiddenPanel } from '../forbidden-panel';
import { PageSection } from './page-section';
import type { SectionData } from './section-data';

/**
 * A section that renders only with its permission, and its forbidden panel on a 403. Optional
 * sections of the inquiry and account pages, the account page's slots among them (C108, F32).
 */
export function OptionalSection<T>({
  id,
  title,
  description,
  data,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly data: SectionData<T> | undefined;
  readonly children: (data: T) => ReactNode;
}) {
  if (data === undefined || data.kind === 'hidden') {
    return null;
  }
  return (
    <PageSection id={id} title={title} {...(description === undefined ? {} : { description })}>
      {data.kind === 'forbidden' ? <ForbiddenPanel headingLevel={3} /> : children(data.data)}
    </PageSection>
  );
}

/**
 * A slot another agent's component fills (F32): its content inside the section, the section left
 * out when the content is `null`.
 */
export function SlotSection({
  id,
  title,
  data,
}: {
  readonly id: string;
  readonly title: string;
  readonly data: SectionData<ReactNode> | undefined;
}) {
  if (data?.kind === 'ready' && (data.data === null || data.data === undefined)) {
    return null;
  }
  return (
    <OptionalSection id={id} title={title} data={data}>
      {(content) => content}
    </OptionalSection>
  );
}
