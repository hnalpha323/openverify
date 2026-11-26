import { GOVERNMENT_ID_EXTRACTION_ATTRIBUTES } from '@openverify/contracts';
import { Fragment, type ReactNode } from 'react';
import { EmptyValue } from '../masked-value';

/**
 * Members the API nulls for an operator without `pii:view` (C15), at any depth of an event
 * payload or an API log: every value of a `fields` object, and these.
 */
const MASKED_MEMBERS: ReadonlySet<string> = new Set(['note', 'ip-address', 'user-agent']);

/**
 * Members the API also nulls in a resource's `attributes` (C31.6): the extraction of a
 * government ID. Its `extraction-sources` names fields only and is never masked.
 */
const MASKED_ATTRIBUTES: ReadonlySet<string> = new Set(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES);

/** Whether the API masks the member `key` of an object (a `fields` or `attributes` one). */
const isMaskedMember = (key: string, isFields: boolean, isAttributes: boolean): boolean =>
  isFields || MASKED_MEMBERS.has(key) || (isAttributes && MASKED_ATTRIBUTES.has(key));

const INDENT = '  ';

const HIDDEN_EXPLANATION = 'Hidden: your role cannot see personal data (the pii:view permission).';

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A masked value in the JSON: the word Hidden instead of `null`. */
function HiddenToken() {
  return (
    <span className="rounded bg-canvas px-1 font-sans text-xs font-medium text-ink-muted ring-1 ring-line ring-inset">
      Hidden
    </span>
  );
}

interface NodeProps {
  readonly value: unknown;
  readonly depth: number;
  /** Whether a `null` here is a value the API masks. */
  readonly maskable: boolean;
  /** Whether this object is a `fields` object, whose every value the API masks. */
  readonly isFields: boolean;
  /** Whether this object is a resource's `attributes`, whose extraction the API masks. */
  readonly isAttributes: boolean;
  readonly masked: boolean;
}

function JsonNode({
  value,
  depth,
  maskable,
  isFields,
  isAttributes,
  masked,
}: NodeProps): ReactNode {
  if (value === null) {
    return masked && maskable ? <HiddenToken /> : 'null';
  }
  const inner = INDENT.repeat(depth + 1);
  const outer = INDENT.repeat(depth);
  if (Array.isArray(value)) {
    const items = value as readonly unknown[];
    if (items.length === 0) {
      return '[]';
    }
    return (
      <>
        {'[\n'}
        {items.map((item, index) => (
          <Fragment key={index}>
            {inner}
            <JsonNode
              value={item}
              depth={depth + 1}
              maskable={false}
              isFields={false}
              isAttributes={false}
              masked={masked}
            />
            {index < items.length - 1 ? ',\n' : '\n'}
          </Fragment>
        ))}
        {`${outer}]`}
      </>
    );
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    return (
      <>
        {'{\n'}
        {entries.map(([key, member], index) => (
          <Fragment key={key}>
            {`${inner}${JSON.stringify(key)}: `}
            <JsonNode
              value={member}
              depth={depth + 1}
              maskable={isMaskedMember(key, isFields, isAttributes)}
              isFields={key === 'fields' && isObject(member)}
              isAttributes={key === 'attributes' && isObject(member)}
              masked={masked}
            />
            {index < entries.length - 1 ? ',\n' : '\n'}
          </Fragment>
        ))}
        {`${outer}}`}
      </>
    );
  }
  return JSON.stringify(value);
}

/** Whether `value` holds a `null` the API masked. */
function hasMaskedValue(
  value: unknown,
  maskable = false,
  isFields = false,
  isAttributes = false,
): boolean {
  if (value === null) {
    return maskable;
  }
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).some((item) => hasMaskedValue(item));
  }
  if (isObject(value)) {
    return Object.entries(value).some(([key, member]) =>
      hasMaskedValue(
        member,
        isMaskedMember(key, isFields, isAttributes),
        key === 'fields' && isObject(member),
        key === 'attributes' && isObject(member),
      ),
    );
  }
  return false;
}

/** A region keyboard users can scroll, holding preformatted text. */
function CodeRegion({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-[32rem] overflow-auto rounded-md border border-line bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <pre className="p-3 font-mono text-xs leading-5 text-ink">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export interface JsonViewProps {
  /** Names the region, such as "Payload". */
  readonly label: string;
  /** Parsed JSON. */
  readonly value: unknown;
  /**
   * Whether the API masks personal data for this operator (no `pii:view`): a masked member's
   * `null` then reads "Hidden".
   */
  readonly masked: boolean;
}

/**
 * A JSON document (an event payload, an API log body) as indented JSON. Values the API masked
 * read "Hidden", with an explanation; the API stays the judge of what is masked.
 */
export function JsonView({ label, value, masked }: JsonViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {masked && hasMaskedValue(value) && (
        <p className="text-xs text-ink-muted">{HIDDEN_EXPLANATION}</p>
      )}
      <CodeRegion label={label}>
        <JsonNode
          value={value}
          depth={0}
          maskable={false}
          isFields={false}
          isAttributes={false}
          masked={masked}
        />
      </CodeRegion>
    </div>
  );
}

interface TruncatedValue {
  readonly truncated: true;
  readonly 'byte-length': number;
  readonly preview: string;
}

/** C12: an API log value over 64 KiB is stored as `{ truncated, byte-length, preview }`. */
function isTruncated(value: unknown): value is TruncatedValue {
  return (
    isObject(value) &&
    value.truncated === true &&
    typeof value['byte-length'] === 'number' &&
    typeof value.preview === 'string' &&
    Object.keys(value).length === 3
  );
}

const BYTES = new Intl.NumberFormat('en-US');

/**
 * An API log's query or body: "None" when there was none; the size and the start of a value
 * too large to keep whole (its preview is cut from the masked JSON, so it never shows personal
 * data); otherwise the JSON.
 */
export function LoggedJson({ label, value, masked }: JsonViewProps) {
  if (value === null || value === undefined) {
    return <EmptyValue />;
  }
  if (isTruncated(value)) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">
          {`Too large to keep whole: ${BYTES.format(value['byte-length'])} bytes. The start of it follows, with personal data masked.`}
        </p>
        <CodeRegion label={`${label} (start)`}>{value.preview}</CodeRegion>
      </div>
    );
  }
  return <JsonView label={label} value={value} masked={masked} />;
}
