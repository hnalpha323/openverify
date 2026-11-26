import { COPY_COPY } from '../../lib/copy/themes-copy';

const copy = COPY_COPY.rules;

function RuleList({
  heading,
  items,
}: {
  readonly heading: string;
  readonly items: Readonly<Record<string, string>>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{heading}</h3>
      <ul className="list-disc ps-5 text-sm text-ink-muted">
        {Object.entries(items).map(([key, item]) => (
          <li key={key}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * C162.3-C162.5: the rules every text meets, the consent-copy rule with its acknowledgements, and
 * which text a person sees (the fallbacks the flow applies), in words.
 */
export function CopyRules() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <RuleList heading={copy.consentHeading} items={copy.consentItems} />
      <RuleList heading={copy.fallbackHeading} items={copy.fallbackItems} />
      <RuleList heading={copy.plainHeading} items={copy.plainItems} />
    </div>
  );
}
