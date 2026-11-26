import { Badge } from '../status-badge';

/** C244.4: the seeded partner, labelled a sample wherever it is named. */
export function SampleLabel() {
  return (
    <span className="ms-2">
      <Badge status="sample" label="Sample organization" tone="neutral" />
    </span>
  );
}
