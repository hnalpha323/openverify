# @openverify/js

The OpenVerify embed client: it mounts the hosted verification flow in a sandboxed iframe on your
page and tells you what the flow reports. It has no runtime dependency.

This package is a client. The server decides every step: which steps run, what is checked and what
the result is. The completion the flow reports in the browser is a hint, never the decision, so act
on webhooks or the server API (for example with `@openverify/node`), never on `onComplete` alone.

## Installing

The package is not published to a registry yet. Install it from a packed tarball of a release, or
build it from source:

```sh
# from a release's tarball (check its SHA-256 against the release's checksum file first)
npm install ./openverify-js-<version>.tgz

# from source, in a checkout of the repository
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@openverify/js
node packages/sdk-react/scripts/pack-release.ts --out ./packed packages/sdk-js
```

## Use it as a module

```ts
import { embed } from '@openverify/js';

const handle = embed({
  container: '#verification', // an element or a selector
  flowUrl: 'https://flow.example.com', // where your installation serves the flow
  inquiryId: 'inq_01JD2K4V6W8X0Y2Z4A6B8C0D2E', // created by your server
  sessionToken: sessionTokenFromYourServer, // or oneTimeLink
  onReady: () => console.log('the flow is showing'),
  onComplete: ({ inquiryId }) => askYourServerForTheResult(inquiryId), // a hint only
  onError: ({ code, message }) => console.warn(code, message),
});

// later, to remove the frame and stop listening:
handle.destroy();
```

## Use it with a script tag

`dist/openverify.iife.js` defines the global `OpenVerify`:

```html
<div id="verification"></div>
<script src="/vendor/openverify.iife.js"></script>
<script>
  OpenVerify.embed({ container: '#verification', flowUrl, inquiryId, sessionToken });
</script>
```

## Options and events

| Option                                     | Meaning                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `container`                                | The element to mount in, or a selector for it                            |
| `flowUrl`, `inquiryId`                     | Where the flow is served, and the inquiry your server created            |
| `sessionToken` or `oneTimeLink`            | The credential your server obtained; it travels in the URL fragment only |
| `language`, `styleVariant`                 | The flow's language, and `light` or `dark`                               |
| `iframeTitle`, `frameHeight`, `frameWidth` | The frame's accessible name and size (a width of at most 768 CSS px)     |
| `onLoad`, `onReady`, `onEvent`             | The frame loaded, the flow is showing, a step event (its name and type)  |
| `onComplete`, `onCancel`, `onError`        | The flow ended (a hint), the person left, or an error with a public code |
| `eventsAllowlist`                          | Only these events reach `onEvent`                                        |

The client accepts a message only from the flow's origin and from its own frame, and only in the
protocol's exact shape. Events carry step names and types, never a value the person entered.

## Licence

Apache-2.0. See `LICENSE`.
