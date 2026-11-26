import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HiddenValue } from '../components/hidden-value';
import { rscPayloadOf } from './rsc-payload';

/** A server component that keeps one of its props on the server. */
function Greeting({ name, secret }: { readonly name: string; readonly secret: string }) {
  return <p data-length={secret.length}>Hello {name}</p>;
}

/** A server component with a hook React allows on the server. */
function Labelled({ children }: { readonly children: ReactNode }) {
  const id = useId();
  return <span id={id}>{children}</span>;
}

async function Loaded({ value }: { readonly value: string }) {
  await Promise.resolve();
  return <em>{value}</em>;
}

describe('rscPayloadOf: what a server tree sends to the browser', () => {
  it('holds what server components render, not the props they keep', async () => {
    const payload = await rscPayloadOf(<Greeting name="NORA" secret="SERVER-ONLY-VALUE" />);

    expect(payload).toContain('Hello');
    expect(payload).toContain('NORA');
    expect(payload).not.toContain('SERVER-ONLY-VALUE');
  });

  it('holds every prop of a client component, whether or not it renders it', async () => {
    const payload = await rscPayloadOf(<HiddenValue explanation="CLIENT-PROP-VALUE" />);

    expect(payload).toContain('CLIENT-PROP-VALUE');
  });

  it('walks what a client component is given to render', async () => {
    const payload = await rscPayloadOf(
      <Link href="/inquiries/inq_1">
        <Labelled>
          <Greeting name="CHILD-OF-CLIENT" secret="x" />
        </Labelled>
      </Link>,
    );

    expect(payload).toContain('/inquiries/inq_1');
    expect(payload).toContain('CHILD-OF-CLIENT');
  });

  it('awaits async server components', async () => {
    await expect(rscPayloadOf(<Loaded value="ASYNC-VALUE" />)).resolves.toContain('ASYNC-VALUE');
  });

  it('passes on what a server component throws', async () => {
    function Broken(): never {
      throw new Error('not found');
    }

    await expect(rscPayloadOf(<Broken />)).rejects.toThrow('not found');
  });

  it('holds a value that is not an element as JSON', async () => {
    await expect(rscPayloadOf({ odd: 'OBJECT-VALUE' } as never)).resolves.toContain('OBJECT-VALUE');
  });

  it('holds plain text, numbers and lists, and nothing for empty nodes', async () => {
    const payload = await rscPayloadOf([
      'TEXT',
      42,
      null,
      false,
      undefined,
      [<b key="b">NESTED</b>],
      <>{'FRAGMENT'}</>,
    ]);

    expect(payload).toContain('TEXT');
    expect(payload).toContain('42');
    expect(payload).toContain('NESTED');
    expect(payload).toContain('FRAGMENT');
  });
});
