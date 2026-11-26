import Link from 'next/link';
import type { ReactNode } from 'react';
import { LINK_CLASS } from '../../link-styles';
import { OpenLink } from './open-link';

/** The console page of each id kind a comment may name (C134.3). */
const ID_PAGES: Readonly<Record<string, string>> = Object.freeze({
  inq: '/inquiries',
  acc: '/accounts',
  case: '/cases',
  txn: '/transactions',
  rep: '/reports',
  ver: '/verifications',
});

const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
/** A mention token, an OpenVerify id of a kind above, or a bare `https://` address. */
const TOKEN = new RegExp(
  `@\\[(usr_${ULID})\\]|\\b((?:inq|acc|case|txn|rep|ver)_${ULID})\\b|(https://[^\\s<>"']+)`,
  'g',
);

/** The host of an address, or `null` for one that is not a URL. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).host;
  } catch {
    return null;
  }
}

export interface CommentTextProps {
  readonly message: string;
  /** The operator reading: a mention of them reads "@you". */
  readonly viewerId: string;
  /** Who a user id is, when the reader may read users; otherwise the id shows. */
  readonly people?: ReadonlyMap<string, string>;
}

/**
 * A comment as plain text (C134.3, decision 61): React text in `whitespace-pre-wrap`, so nothing a
 * commenter typed is ever markup. Mentions show who they name, OpenVerify ids link to their own
 * pages (which check their own scope), and an `https://` address stays text with its host shown
 * before any link. No Markdown, no image, no raw HTML.
 */
export function CommentText({ message, viewerId, people }: CommentTextProps) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of message.matchAll(TOKEN)) {
    const index = match.index;
    if (index > last) {
      parts.push(message.slice(last, index));
    }
    const [whole, mention, id, address] = match;
    if (mention !== undefined) {
      parts.push(
        <span key={index} className="font-medium">
          @{mention === viewerId ? 'you' : (people?.get(mention) ?? mention)}
        </span>,
      );
    } else if (id !== undefined) {
      const page = ID_PAGES[id.slice(0, id.indexOf('_'))] ?? '';
      parts.push(
        <Link key={index} href={`${page}/${id}`} className={`${LINK_CLASS} font-mono text-xs`}>
          {id}
        </Link>,
      );
    } else if (address !== undefined) {
      const host = hostOf(address);
      parts.push(host === null ? address : <OpenLink key={index} address={address} host={host} />);
    }
    last = index + whole.length;
  }
  if (last < message.length) {
    parts.push(message.slice(last));
  }
  return <span className="whitespace-pre-wrap">{parts}</span>;
}
