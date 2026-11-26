# Third-party recipients

This is not legal advice.

Not reviewed by counsel.

Generated from the provider registry (`apps/api/src/providers/index.ts`) by `pnpm --filter @openverify/docs-tools docs:compliance`; do not edit it by hand. A test fails when this page and a fresh render differ. It lists every provider an install can bind, what each sends where, and the egress that is not a provider (C278.2). Each provider you bind is a recipient, and for your clients' data a sub-processor; list it in your [record of processing](record-of-processing.md).

## Provider kinds

Each kind is bound per environment kind by its variable (`OPENVERIFY_PROVIDER_{KIND}_{MODE}`). An unset or empty variable leaves a kind unbound, so its checks answer `provider_not_configured`, except where the last column says otherwise (the values below are read from the registry with no variable set). `sandbox` is deterministic, sends nothing and is refused for production environments; each process reads only the kinds it uses.

| Kind | Variable | Read by | Takes | Unset in a production environment |
|---|---|---|---|---|
| `aamva` | `OPENVERIFY_PROVIDER_AAMVA_{SANDBOX,PRODUCTION}` | API and worker | `sandbox` | unbound |
| `publicFigure` | `OPENVERIFY_PROVIDER_PUBLIC_FIGURE_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `ageEstimate` | `OPENVERIFY_PROVIDER_AGE_ESTIMATE_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `selfieAgeEstimate` | `OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `selfiePublicFigure` | `OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `suspiciousEntity` | `OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `sms` | `OPENVERIFY_PROVIDER_SMS_{SANDBOX,PRODUCTION}` | API and worker | `twilio`, `sandbox` | unbound |
| `database` | `OPENVERIFY_PROVIDER_DATABASE_{SANDBOX,PRODUCTION}` | API and worker | `sandbox` | unbound |
| `evmRpc` | `OPENVERIFY_PROVIDER_EVM_RPC_{SANDBOX,PRODUCTION}` | worker | `json-rpc`, `sandbox` | unbound |
| `businessRegistry` | `OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_{SANDBOX,PRODUCTION}` | worker | `gleif`, `companies-house`, `sec-edgar`, `sandbox` | `gleif`; plus `companies-house` with `OPENVERIFY_COMPANIES_HOUSE_API_KEY` set; plus `sec-edgar` with `OPENVERIFY_SEC_EDGAR_USER_AGENT` set |
| `domainAge` | `OPENVERIFY_PROVIDER_DOMAIN_AGE_{SANDBOX,PRODUCTION}` | worker | `rdap`, `sandbox` | `rdap` |
| `maliciousWebsite` | `OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_{SANDBOX,PRODUCTION}` | worker | `feed-list`, `sandbox` | unbound |
| `backlink` | `OPENVERIFY_PROVIDER_BACKLINK_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `adverseMedia` | `OPENVERIFY_PROVIDER_ADVERSE_MEDIA_{SANDBOX,PRODUCTION}` | worker | `gdelt-doc`, `sandbox` | unbound |
| `emailIntelligence` | `OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_{SANDBOX,PRODUCTION}` | worker | `hibp`, `sandbox` | unbound |
| `phoneIntelligence` | `OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_{SANDBOX,PRODUCTION}` | worker | `twilio-lookup`, `sandbox` | unbound |
| `addressVerification` | `OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_{SANDBOX,PRODUCTION}` | worker | `smarty`, `sandbox` | unbound |
| `cryptoExposure` | `OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_{SANDBOX,PRODUCTION}` | worker | `sandbox` | unbound |
| `ipReputation` | `OPENVERIFY_PROVIDER_IP_REPUTATION_{SANDBOX,PRODUCTION}` | API and worker | `mmdb-file`, `sandbox` | unbound |
| `slack` | `OPENVERIFY_PROVIDER_SLACK_{SANDBOX,PRODUCTION}` | worker | `incoming-webhook`, `sandbox` | unbound |
| `attachmentScanner` | `OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_{SANDBOX,PRODUCTION}` | worker | `clamd`, `sandbox` | unbound |
| `deviceIntegrity` | `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_{SANDBOX,PRODUCTION}` | API and worker | `play-integrity`, `sandbox` | unbound |

## What each real adapter sends

| Provider | Kind | Recipient | What it receives | Needs |
|---|---|---|---|---|
| `clamd` | `attachmentScanner` | The operator-run ClamAV daemon (no ClamAV image ships) | The bytes of each case attachment, to scan | `OPENVERIFY_CLAMD_SOCKET` (a Unix socket or a private address) |
| `companies-house` | `businessRegistry` | UK Companies House's public data API | A business's registration number or name | `OPENVERIFY_COMPANIES_HOUSE_API_KEY` (and `OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY` for sandbox environments) |
| `feed-list` | `maliciousWebsite` | The publishers of the feeds the operator lists in `data/malicious-feeds.json` (ships empty) | Nothing per lookup: the worker downloads each feed and checks a website locally | Feeds listed by the operator |
| `gdelt-doc` | `adverseMedia` | The GDELT Project (the DOC 2.0 API) | The screened name of a person or business, as a search query | `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true` |
| `gleif` | `businessRegistry` | GLEIF (the Global Legal Entity Identifier Foundation) API | A business's LEI, registration number or legal name | Nothing: bound by default (see above); `none` unbinds it |
| `hibp` | `emailIntelligence` | Have I Been Pwned | The email address only | `OPENVERIFY_HIBP_API_KEY` |
| `incoming-webhook` | `slack` | Slack, at the incoming-webhook URL a workflow secret holds, and whoever reads the channel | The rendered message of a `send_slack_message` step | A webhook URL stored as a workflow secret |
| `json-rpc` | `evmRpc` | The EVM node the operator names for each chain | A wallet or contract address and the call made on it (`eth_call`, `eth_getCode`) | `OPENVERIFY_EVM_RPC_URLS` (private networks only with `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS`) |
| `mmdb-file` | `ipReputation` | Nobody: an operator-licensed file read locally | Nothing leaves the install | `OPENVERIFY_IP_REPUTATION_MMDB_PATH` |
| `play-integrity` | `deviceIntegrity` | Google (the Play Integrity API, and its OAuth token endpoint) | The device's integrity token, to decode, with the host app's package name | `OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME`, `OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS`, `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`; publish requires the notice `notice.play-integrity` |
| `rdap` | `domainAge` | The domain's registry RDAP server, found through IANA's bootstrap file | A business website's domain name | Nothing: bound by default (see above); `none` unbinds it |
| `sec-edgar` | `businessRegistry` | The US SEC (EDGAR) | A listed company's CIK; a name is matched locally against the downloaded ticker list | `OPENVERIFY_SEC_EDGAR_USER_AGENT` (the operator's contact) |
| `smarty` | `addressVerification` | Smarty (the US Street API) | A US address's normalised components; the addressee only with `send-addressee` | `OPENVERIFY_SMARTY_AUTH_ID`, `OPENVERIFY_SMARTY_AUTH_TOKEN` |
| `twilio` | `sms` | Twilio's Messaging API, and the phone's carrier | The phone number and the message (a one-time code, or a workflow message) | `OPENVERIFY_TWILIO_ACCOUNT_SID`, `OPENVERIFY_TWILIO_API_KEY_SID`, `OPENVERIFY_TWILIO_API_KEY_SECRET`, and `OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID` or `OPENVERIFY_TWILIO_FROM` |
| `twilio-lookup` | `phoneIntelligence` | Twilio's Lookup API | The phone number | `OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID`, `OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID`, `OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET` |

Kinds with only the sandbox provider: `aamva`, `publicFigure`, `ageEstimate`, `selfieAgeEstimate`, `selfiePublicFigure`, `suspiciousEntity`, `database`, `backlink`, `cryptoExposure`: no real adapter in this version, so no recipient.

## Egress that is not a provider kind

| Egress | Recipient | What it carries | Configured by |
|---|---|---|---|
| Email (one-time links, invitations, notifications, workflow `send_email`) | The SMTP server the operator names, then the addressee's mail provider | The message and the address | `OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM`; unset, no mail is sent |
| Webhooks | The endpoints each environment's webhooks name | Event payloads, with the attribute blocklist and masking ([webhooks](../settings/webhooks.md)) | The operator's webhook settings |
| Workflow `make_https_request` | The endpoint a workflow names | What the step's body holds; personal values need `egress:<step id>` and are audited ([HTTPS request](../workflows/https-request.md)) | The workflow's publisher |
| Connect | Another organisation on the same install | The categories the share policy and the person's consent allow ([sharing](sharing.md)) | `OPENVERIFY_CONNECT_ENABLED` and both organisations |
| Downloads (sanctions and PEP lists, network data, chip trust anchors) | Requests to each publisher | No personal data; the PEP sync sends the operator's contact (`OPENVERIFY_WIKIDATA_USER_AGENT`) | The sync settings ([licensed data](licensed-data.md)) |
| The vision service and the code runner | Parts of the install, not third parties | Images to vision; workflow code to the code runner, which has no network | `OPENVERIFY_VISION_URL`, `OPENVERIFY_WORKFLOW_CODE_RUNNER` |
