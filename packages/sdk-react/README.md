# @openverify/react

React bindings for the OpenVerify embed client, `@openverify/js`: an `<OpenVerifyFlow>` component
and a `useOpenVerify` hook. They add nothing the embed client cannot do, and they keep no state
beyond the embed's own events. React 19 is a peer dependency.

These bindings are a client. The server decides every step: which steps run, what is checked and
what the result is. The `complete` status the flow reports in the browser is a hint, never the
decision, so act on webhooks or the server API, never on the browser's status alone.

## Installing

The package is not published to a registry yet. Install it, with `@openverify/js` of the same
release, from the release's packed tarballs, or build it from source:

```sh
# from a release's tarballs (check each SHA-256 against the release's checksum file first)
npm install ./openverify-js-<version>.tgz ./openverify-react-<version>.tgz

# from source, in a checkout of the repository
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@openverify/react
node packages/sdk-react/scripts/pack-release.ts --out ./packed packages/sdk-js packages/sdk-react
```

## The component

```tsx
import { OpenVerifyFlow } from '@openverify/react';

export function Verification({
  inquiryId,
  sessionToken,
}: {
  inquiryId: string;
  sessionToken: string;
}) {
  return (
    <OpenVerifyFlow
      flowUrl="https://flow.example.com"
      inquiryId={inquiryId}
      sessionToken={sessionToken}
      className="verification"
      onComplete={({ inquiryId: id }) => void askYourServerForTheResult(id)} // a hint only
    />
  );
}
```

Its props are the embed's options (see `@openverify/js`) plus the container's `id`, `className`
and `style`.

## The hook

```tsx
import { useOpenVerify } from '@openverify/react';

function Verification(props: { inquiryId: string; sessionToken: string }) {
  const { ref, state } = useOpenVerify({ flowUrl: 'https://flow.example.com', ...props });
  return (
    <>
      <p role="status">{state.status}</p>
      <div ref={ref} />
    </>
  );
}
```

`state.status` is `mounting`, `loaded`, `ready`, `complete` (a hint), `cancelled` or `error`;
`state.lastEvent` is the flow's last event (its name and step type, never a value the person
entered), `state.completion` the flow's completion message and `state.error` the embed's error with
its public code. Options the embed refuses become the `error` state with `invalid_config`, so a
render never throws for them. A new handler takes effect from the next event without a new frame;
the frame is mounted again only when the flow URL, the inquiry, the credential, the language, the
style, the title, the size or the event allowlist changes.

## Licence

Apache-2.0. See `LICENSE`.
