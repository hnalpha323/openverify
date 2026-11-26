import type { ResolvedTemplateSettings } from '@openverify/contracts';
import { Detail } from '../detail';

const seconds = (value: number) => `${value.toLocaleString('en-US')} seconds`;

/** A version's settings in force (C11), in words. */
export function TemplateSettingsList({
  settings,
}: {
  readonly settings: ResolvedTemplateSettings;
}) {
  const retention = settings['retention-days'];
  return (
    <>
      <Detail term="Inquiry lifetime">{seconds(settings['inquiry-expiration-seconds'])}</Detail>
      <Detail term="Session lifetime">{seconds(settings['session-expiration-seconds'])}</Detail>
      <Detail term="One-time link lifetime">
        {seconds(settings['one-time-link-expiration-seconds'])}
      </Detail>
      <Detail term="Retention">
        {retention === null ? 'Environment default' : `${retention.toLocaleString('en-US')} days`}
      </Detail>
    </>
  );
}
