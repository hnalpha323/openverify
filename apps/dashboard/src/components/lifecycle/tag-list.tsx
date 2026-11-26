import { EmptyValue } from '../masked-value';

const TAG_CLASS =
  'inline-flex items-center rounded-md bg-canvas px-2 py-0.5 text-xs font-medium text-ink ring-1 ring-line ring-inset';

/** An object's tags, read-only: a list named "Tags", or an em dash when there are none. */
export function TagList({ tags }: { readonly tags: readonly string[] }) {
  if (tags.length === 0) {
    return <EmptyValue />;
  }
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag} className={TAG_CLASS}>
          {tag}
        </li>
      ))}
    </ul>
  );
}

export { TAG_CLASS };
