/**
 * C278.2's third-party recipients (checkpoint 2): `docs/compliance/recipients.md`, generated from the
 * provider registry. Every kind with what an unset variable binds, then every real adapter with its
 * recipient and what it receives ({@link RECIPIENT_DETAILS}, held by a test to the registry's names),
 * then the egress that is not a provider kind.
 */
import { COUNSEL_LINE } from './pages.js';
import type { ProviderFacts } from './provider-facts.js';

/** What one real adapter sends where, and what binding it needs. */
export interface RecipientDetail {
  readonly recipient: string;
  readonly receives: string;
  readonly needs: string;
}

/**
 * One entry per real provider name of the registry (every name but the sandbox), read from each
 * adapter's module under `apps/api/src/providers/` and `apps/api/src/services/device-integrity/`.
 */
export const RECIPIENT_DETAILS: Readonly<Record<string, RecipientDetail>> = Object.freeze({
  clamd: {
    recipient: 'The operator-run ClamAV daemon (no ClamAV image ships)',
    receives: 'The bytes of each case attachment, to scan',
    needs: '`OPENVERIFY_CLAMD_SOCKET` (a Unix socket or a private address)',
  },
  'companies-house': {
    recipient: "UK Companies House's public data API",
    receives: "A business's registration number or name",
    needs:
      '`OPENVERIFY_COMPANIES_HOUSE_API_KEY` (and `OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY` for sandbox environments)',
  },
  'feed-list': {
    recipient:
      'The publishers of the feeds the operator lists in `data/malicious-feeds.json` (ships empty)',
    receives: 'Nothing per lookup: the worker downloads each feed and checks a website locally',
    needs: 'Feeds listed by the operator',
  },
  'gdelt-doc': {
    recipient: 'The GDELT Project (the DOC 2.0 API)',
    receives: 'The screened name of a person or business, as a search query',
    needs: '`OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`',
  },
  gleif: {
    recipient: 'GLEIF (the Global Legal Entity Identifier Foundation) API',
    receives: "A business's LEI, registration number or legal name",
    needs: 'Nothing: bound by default (see above); `none` unbinds it',
  },
  hibp: {
    recipient: 'Have I Been Pwned',
    receives: 'The email address only',
    needs: '`OPENVERIFY_HIBP_API_KEY`',
  },
  'incoming-webhook': {
    recipient:
      'Slack, at the incoming-webhook URL a workflow secret holds, and whoever reads the channel',
    receives: 'The rendered message of a `send_slack_message` step',
    needs: 'A webhook URL stored as a workflow secret',
  },
  'json-rpc': {
    recipient: 'The EVM node the operator names for each chain',
    receives: 'A wallet or contract address and the call made on it (`eth_call`, `eth_getCode`)',
    needs:
      '`OPENVERIFY_EVM_RPC_URLS` (private networks only with `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS`)',
  },
  'mmdb-file': {
    recipient: 'Nobody: an operator-licensed file read locally',
    receives: 'Nothing leaves the install',
    needs: '`OPENVERIFY_IP_REPUTATION_MMDB_PATH`',
  },
  'play-integrity': {
    recipient: 'Google (the Play Integrity API, and its OAuth token endpoint)',
    receives: "The device's integrity token, to decode, with the host app's package name",
    needs:
      '`OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME`, `OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS`, `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`; publish requires the notice `notice.play-integrity`',
  },
  rdap: {
    recipient: "The domain's registry RDAP server, found through IANA's bootstrap file",
    receives: "A business website's domain name",
    needs: 'Nothing: bound by default (see above); `none` unbinds it',
  },
  'sec-edgar': {
    recipient: 'The US SEC (EDGAR)',
    receives:
      "A listed company's CIK; a name is matched locally against the downloaded ticker list",
    needs: "`OPENVERIFY_SEC_EDGAR_USER_AGENT` (the operator's contact)",
  },
  smarty: {
    recipient: 'Smarty (the US Street API)',
    receives: "A US address's normalised components; the addressee only with `send-addressee`",
    needs: '`OPENVERIFY_SMARTY_AUTH_ID`, `OPENVERIFY_SMARTY_AUTH_TOKEN`',
  },
  twilio: {
    recipient: "Twilio's Messaging API, and the phone's carrier",
    receives: 'The phone number and the message (a one-time code, or a workflow message)',
    needs:
      '`OPENVERIFY_TWILIO_ACCOUNT_SID`, `OPENVERIFY_TWILIO_API_KEY_SID`, `OPENVERIFY_TWILIO_API_KEY_SECRET`, and `OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID` or `OPENVERIFY_TWILIO_FROM`',
  },
  'twilio-lookup': {
    recipient: "Twilio's Lookup API",
    receives: 'The phone number',
    needs:
      '`OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID`, `OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID`, `OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET`',
  },
});

/** A binding as the page writes it. */
function binding(value: unknown): string {
  if (value === null || value === undefined) return 'unbound';
  const names: readonly unknown[] = Array.isArray(value) ? value : [value];
  return names
    .map((name) => `\`${typeof name === 'string' ? name : JSON.stringify(name)}\``)
    .join(', ');
}

/** What an unset variable binds in production, with what each widening variable adds. */
function unsetCell(facts: ProviderFacts, kind: string): string {
  const plain = facts.unsetDefaults[kind];
  const before = new Set(Array.isArray(plain) ? (plain as unknown[]) : [plain]);
  const additions = Object.entries(facts.widenedDefaults).flatMap(([variable, defaults]) => {
    const widened = defaults[kind];
    const added = (Array.isArray(widened) ? (widened as unknown[]) : [widened]).filter(
      (name) => name !== null && name !== undefined && !before.has(name),
    );
    return added.length === 0 ? [] : [`plus ${binding(added)} with \`${variable}\` set`];
  });
  return [binding(plain), ...additions].join('; ');
}

const cell = (text: string): string => text.replaceAll('|', '\\|');

/** The page's text for `facts`. */
export function renderRecipientsPage(facts: ProviderFacts): string {
  const realNames = (kind: string): readonly string[] =>
    (facts.namesByKind[kind] ?? []).filter((name) => name !== facts.sandbox);
  const kindsOf = new Map<string, string[]>();
  for (const kind of facts.kinds) {
    for (const name of realNames(kind)) {
      kindsOf.set(name, [...(kindsOf.get(name) ?? []), kind]);
    }
  }
  const names = [...kindsOf.keys()].sort();
  const sandboxOnly = facts.kinds.filter((kind) => realNames(kind).length === 0);

  const kindRows = facts.kinds.map((kind) =>
    [
      `\`${kind}\``,
      `\`${facts.prefixes[kind] ?? ''}_{SANDBOX,PRODUCTION}\``,
      facts.apiKinds.includes(kind) ? 'API and worker' : 'worker',
      (facts.namesByKind[kind] ?? []).map((name) => `\`${name}\``).join(', '),
      unsetCell(facts, kind),
    ].join(' | '),
  );
  const recipientRows = names.map((name) => {
    const detail = RECIPIENT_DETAILS[name];
    if (detail === undefined) {
      throw new Error(`no recipient detail for the provider name ${name}`);
    }
    const kinds = (kindsOf.get(name) ?? []).map((kind) => `\`${kind}\``).join(', ');
    return [
      `\`${name}\``,
      kinds,
      cell(detail.recipient),
      cell(detail.receives),
      cell(detail.needs),
    ].join(' | ');
  });

  return [
    '# Third-party recipients',
    '',
    'This is not legal advice.',
    '',
    COUNSEL_LINE,
    '',
    "Generated from the provider registry (`apps/api/src/providers/index.ts`) by `pnpm --filter @openverify/docs-tools docs:compliance`; do not edit it by hand. A test fails when this page and a fresh render differ. It lists every provider an install can bind, what each sends where, and the egress that is not a provider (C278.2). Each provider you bind is a recipient, and for your clients' data a sub-processor; list it in your [record of processing](record-of-processing.md).",
    '',
    '## Provider kinds',
    '',
    'Each kind is bound per environment kind by its variable (`OPENVERIFY_PROVIDER_{KIND}_{MODE}`). An unset or empty variable leaves a kind unbound, so its checks answer `provider_not_configured`, except where the last column says otherwise (the values below are read from the registry with no variable set). `sandbox` is deterministic, sends nothing and is refused for production environments; each process reads only the kinds it uses.',
    '',
    '| Kind | Variable | Read by | Takes | Unset in a production environment |',
    '|---|---|---|---|---|',
    ...kindRows.map((row) => `| ${row} |`),
    '',
    '## What each real adapter sends',
    '',
    '| Provider | Kind | Recipient | What it receives | Needs |',
    '|---|---|---|---|---|',
    ...recipientRows.map((row) => `| ${row} |`),
    '',
    `Kinds with only the sandbox provider: ${sandboxOnly.map((kind) => `\`${kind}\``).join(', ')}: no real adapter in this version, so no recipient.`,
    '',
    '## Egress that is not a provider kind',
    '',
    '| Egress | Recipient | What it carries | Configured by |',
    '|---|---|---|---|',
    "| Email (one-time links, invitations, notifications, workflow `send_email`) | The SMTP server the operator names, then the addressee's mail provider | The message and the address | `OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM`; unset, no mail is sent |",
    "| Webhooks | The endpoints each environment's webhooks name | Event payloads, with the attribute blocklist and masking ([webhooks](../settings/webhooks.md)) | The operator's webhook settings |",
    "| Workflow `make_https_request` | The endpoint a workflow names | What the step's body holds; personal values need `egress:<step id>` and are audited ([HTTPS request](../workflows/https-request.md)) | The workflow's publisher |",
    "| Connect | Another organisation on the same install | The categories the share policy and the person's consent allow ([sharing](sharing.md)) | `OPENVERIFY_CONNECT_ENABLED` and both organisations |",
    "| Downloads (sanctions and PEP lists, network data, chip trust anchors) | Requests to each publisher | No personal data; the PEP sync sends the operator's contact (`OPENVERIFY_WIKIDATA_USER_AGENT`) | The sync settings ([licensed data](licensed-data.md)) |",
    '| The vision service and the code runner | Parts of the install, not third parties | Images to vision; workflow code to the code runner, which has no network | `OPENVERIFY_VISION_URL`, `OPENVERIFY_WORKFLOW_CODE_RUNNER` |',
    '',
  ].join('\n');
}
