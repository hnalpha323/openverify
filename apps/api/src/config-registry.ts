/**
 * C277.2 (review F10; Workflow 11B Stage 1b common, foundation-11b): every variable an OpenVerify
 * process reads, with its description, default, whether it is a secret, its `<NAME>_FILE` form
 * (C249.2) and the processes that read it. Names composed at run time are pattern entries
 * (`OPENVERIFY_PROVIDER_{KIND}_{MODE}`, the seeded operators' credentials). The configuration
 * reference (11E), the chart's per-process Secrets (11C) and the cryptographic inventory (11E) are
 * generated from it, and `config-registry.test.ts` fails when a process's sources read a name that
 * is not here.
 *
 * Each agent adds the variables it reads as a named borrowed edit, one entry each (rule 20).
 */

/** The processes of C277.2. */
export const CONFIG_PROCESSES = [
  'api',
  'worker',
  'migrate',
  'dashboard',
  'flow',
  'vision',
  'code-runner',
] as const;
export type ConfigProcess = (typeof CONFIG_PROCESSES)[number];

/** One variable, or a family of names composed at run time. */
export interface ConfigVariable {
  /**
   * The exact name; for a pattern entry, the name with `{PLACEHOLDER}` parts, such as
   * `OPENVERIFY_PROVIDER_{KIND}_{MODE}`.
   */
  readonly name: string;
  /** For a pattern entry: the fixed start every composed name shares. */
  readonly prefix?: string;
  /** What it does, for the configuration reference: one or two sentences. */
  readonly description: string;
  /** The default as the reference shows it, or `null` when unset means "off" or "none". */
  readonly default: string | null;
  /** A secret: never logged, a `change-me` placeholder refused in production. */
  readonly secret: boolean;
  /** `<NAME>_FILE` is read too (C249.2): true for every secret the API, worker or migrate read. */
  readonly fileForm: boolean;
  /** The processes that read it. */
  readonly processes: readonly ConfigProcess[];
}

/** Every variable, in name order. */
export const CONFIG_REGISTRY: readonly ConfigVariable[] = [
  {
    name: 'DATABASE_URL',
    description:
      'Postgres connection of the runtime role (postgres:// URL); db:migrate falls back to it without OPENVERIFY_MIGRATION_DATABASE_URL (C249.3). Holds a credential.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker', 'migrate'],
  },
  {
    name: 'OPENVERIFY_API_HOST',
    description: 'The address the API listens on.',
    default: '127.0.0.1',
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_API_KEY_PEPPER',
    description: 'The HMAC key API key hashes are made with: at least 32 bytes (required).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_API_KEY_PEPPER_PREVIOUS',
    description:
      'Up to two earlier peppers, comma-separated, each at least 32 bytes: keys found under one are re-hashed under the current pepper (C247.1).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_API_PORT',
    description: 'The port the API listens on (0 picks a free one).',
    default: '3000',
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_API_URL',
    description: "The API's base URL as the console's BFF and the flow server reach it.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['dashboard', 'flow'],
  },
  {
    name: 'OPENVERIFY_BLIND_INDEX_KEY',
    description:
      'The blind index key (C31.8): 32 bytes, base64, distinct from the KEK; per-environment subkeys derive from it.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker', 'migrate'],
  },
  {
    name: 'OPENVERIFY_CLAMD_SOCKET',
    description: "clamd's socket, required while attachmentScanner is bound to clamd (C135.5).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_CODE_RUNNER_LISTEN',
    description:
      'host:port the code runner listens on for the tcp: transport (C263.6), instead of its Unix socket; unset, the socket.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['code-runner'],
  },
  {
    name: 'OPENVERIFY_CODE_RUNNER_POOL_SIZE',
    description: "The code runner's isolated child processes (C123.3).",
    default: '4',
    secret: false,
    fileForm: false,
    processes: ['code-runner'],
  },
  {
    name: 'OPENVERIFY_CODE_RUNNER_SOCKET',
    description: 'The Unix socket the code runner listens on (C123.3).',
    default: '/run/code-runner/code-runner.sock',
    secret: false,
    fileForm: false,
    processes: ['code-runner'],
  },
  {
    name: 'OPENVERIFY_CODE_RUNNER_TOKEN',
    description:
      'The token the worker and the code runner share on the tcp: transport (C263.6): at least 32 bytes; required in the worker while OPENVERIFY_WORKFLOW_CODE_RUNNER is tcp:.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker', 'code-runner'],
  },
  {
    name: 'OPENVERIFY_COMPANIES_HOUSE_API_KEY',
    description:
      'The Companies House key for production environments, while businessRegistry names companies-house.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY',
    description:
      'The Companies House key for sandbox environments, while businessRegistry names companies-house.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_CONNECT_ENABLED',
    description:
      'Serves Connect on this install (C231.10, decision 71); each organisation still opts in with connect-inbound.',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS',
    description:
      "A console session's whole lifetime (C245.1; 3,600-86,400, at least the idle limit).",
    default: '43200',
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS',
    description:
      'A console session expires after this long without an authenticated request (C245.1; 300-86,400; provisional, decision 9).',
    default: '1800',
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_DASHBOARD_BFF_TOKEN',
    description:
      "The token the console's server sends the API on dashboard routes: at least 32 characters.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_DASHBOARD_CSP_MODE',
    description: "The console CSP's mode (C170): enforce, or report-only while a policy is tried.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['dashboard'],
  },
  {
    name: 'OPENVERIFY_DASHBOARD_DIST_DIR',
    description:
      'Where next build writes the console, so the e2e stack builds apart from development.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['dashboard'],
  },
  {
    name: 'OPENVERIFY_DASHBOARD_INSECURE_COOKIES',
    description:
      "Drops the Secure flag and __Host- prefix of the console's cookies, for plain-http development only.",
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['dashboard'],
  },
  {
    name: 'OPENVERIFY_DASHBOARD_PUBLIC_URL',
    description:
      "The console's public URL: the base of invitation, explorer and notification links.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'flow'],
  },
  {
    name: 'OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS',
    description: 'Reverse proxies in front of the console whose X-Forwarded-For the BFF trusts.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['dashboard'],
  },
  {
    name: 'OPENVERIFY_EU_FSF_TOKEN',
    description:
      'The EU financial sanctions file token; .env.example leaves it commented out (decision 11).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS',
    description: 'Lets the EVM node URLs be http on a private network (C57.5).',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_EVM_RPC_URLS',
    description:
      'EVM node URLs per chain (eip155:<chain>=https://...), required while evmRpc is bound to json-rpc; they often hold an API key.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_FLOW_API_URL',
    description:
      "The API's public URL, read by the flow server at start and served to the bundle as /config.json and as the connect-src header (C257.1, decision 73); VITE_OPENVERIFY_API_URL is its fallback.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['flow'],
  },
  {
    name: 'OPENVERIFY_FLOW_CORS_ORIGINS',
    description:
      "Browser origins allowed to call the flow API, comma-separated; defaults to the flow's own origin.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_FLOW_FACE_GUIDANCE',
    description:
      "on or off, read when the flow is built: off leaves on-device face guidance (onnxruntime-web) out of the bundle, the image of Phase 10 P2's decline outcome (C289).",
    default: 'on',
    secret: false,
    fileForm: false,
    processes: ['flow'],
  },
  {
    name: 'OPENVERIFY_FLOW_PUBLIC_URL',
    description: "The hosted flow's public URL, the base of resume links (required by the API).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_FLOW_SERVER_API_URL',
    description:
      "The API's base URL as the flow server reaches it, for the internal embed-policy route.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['flow'],
  },
  {
    name: 'OPENVERIFY_FLOW_SERVER_TOKEN',
    description:
      "The flow server's token on the internal embed-policy route (C157.2): at least 32 characters.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'flow'],
  },
  {
    name: 'OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS',
    description: "The flow server's previous token, accepted during a rotation (C174.7).",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS',
    description: 'Reverse proxies in front of the flow server it trusts for the client address.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['flow'],
  },
  {
    name: 'OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE',
    description:
      'Acknowledges what binding adverseMedia to gdelt-doc discloses to GDELT; required for that binding.',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_HANDOFF_SENDS_PER_HOUR',
    description:
      'Email and SMS handoff sends each environment may make per hour; fails closed (C96.3).',
    default: '200',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_HIBP_API_KEY',
    description: 'The Have I Been Pwned key, while emailIntelligence binds it.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_HSTS_MAX_AGE',
    description:
      'Strict-Transport-Security max-age for installs whose TLS terminator cannot add it (C255.1); 0 sends none.',
    default: '0',
    secret: false,
    fileForm: false,
    processes: ['api', 'flow', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_INTERNAL_LISTEN',
    description:
      'host:port of a second listener serving only /api/v1/internal/* (C250.3); unset, they stay on the public listener.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_IP_REPUTATION_MMDB_PATH',
    description:
      'Absolute path of an operator-licensed anonymous-IP MMDB, required while ipReputation binds mmdb-file (C93.5); not a secret.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_KEK',
    description: 'The key-encryption key of envelope encryption: 32 bytes, base64 (required).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker', 'migrate'],
  },
  {
    name: 'OPENVERIFY_KEK_PREVIOUS',
    description:
      'Retired KEKs, comma-separated, kept while kek:rewrap moves every data key to the current KEK.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker', 'migrate'],
  },
  {
    name: 'OPENVERIFY_LOG_LEVEL',
    description: 'The pino log level (fatal, error, warn, info, debug, trace, silent).',
    default: 'info',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_MAIL_FROM',
    description: "The sender address of the install's mail.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS',
    description:
      'How long db:migrate waits for the migrate lock before it exits 75 (C249.4; 1-3,600).',
    default: '600',
    secret: false,
    fileForm: false,
    processes: ['migrate'],
  },
  {
    name: 'OPENVERIFY_MIGRATION_DATABASE_URL',
    description:
      "The migration role's connection for db:migrate, seed:dev and kek:rewrap (C249.3); unset, they use DATABASE_URL with a production warning.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['migrate'],
  },
  {
    name: 'OPENVERIFY_MODE',
    description:
      'production, development or test; unset, it follows NODE_ENV and is production otherwise. Production refuses placeholders and test-only behaviour.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'migrate', 'dashboard', 'flow'],
  },
  {
    name: 'OPENVERIFY_NAT64_PREFIXES',
    description:
      'NAT64 prefixes whose embedded IPv4 addresses the outbound guard checks (RFC 6052 lengths).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_NETWORK_REFRESH',
    description: "The worker's network-refresh job; the API never reads it (C92.2).",
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_NETWORK_SOURCES_DISABLED',
    description: 'Network data sources to turn off, comma-separated ids (C92.2).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_NETWORK_SOURCES_ENABLED',
    description: 'Network data sources off by default to turn on, comma-separated ids (C92.2).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_NFC_ALLOW_ICAO_CRLS',
    description: 'Fetch ICAO PKD CRLs during the trust-store sync (C62.7).',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING',
    description: "The install ceiling of each environment's otp-sms-max-per-hour (C55.7).",
    default: '1000',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_PEP_HEAD_RETENTION_MONTHS',
    description: 'The same for heads of state and government (C80).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_PEP_INCLUDE_RELATIVES',
    description: 'Include relatives and close associates in the PEP list (C80).',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS',
    description: 'How long a PEP position without an end date counts as held (C80).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_PEP_RETENTION_MONTHS',
    description: 'How long a PEP stays listed after a position ends (C80).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS',
    description:
      'The app signing certificate digests a verdict must carry, comma-separated (C211.4).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME',
    description:
      'The Android package name Play Integrity verdicts must name, while deviceIntegrity binds play-integrity (C211.4).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON',
    description:
      'The service account key that decodes Play Integrity tokens, as JSON; its _FILE form is the usual way to mount it (C211.4, orchestrator decision 8).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_POSTGRES_CA_FILE',
    description:
      "Absolute path of the CA that signs Postgres' certificate, for sslmode=verify-full (C249.1).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'migrate'],
  },
  {
    name: 'OPENVERIFY_PROVIDER_{KIND}_{MODE}',
    prefix: 'OPENVERIFY_PROVIDER_',
    description:
      'The provider bound to an A-tier kind per environment kind (SANDBOX or PRODUCTION), for example OPENVERIFY_PROVIDER_SMS_SANDBOX=sandbox (C63); each process reads only its own kinds.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX',
    description:
      'The install ceiling of every per-environment queue cap (C251.2; 1-1,000; provisional).',
    default: '50',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_RATE_LIMIT_API_PER_MINUTE',
    description: 'The api rate policy: requests per minute per API key or user session (C12).',
    default: '300',
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE',
    description: 'The reports rate policy: report creations per minute per environment (C72.5).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_REDIS_CA_FILE',
    description: "Absolute path of the CA that signs Valkey's certificate, for rediss:// (C249.1).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'migrate'],
  },
  {
    name: 'OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY',
    description: 'The most adverse media runs one environment may make a day (C72.5).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT',
    description: 'The most recurring reports one environment may hold (C72.5).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_S3_CA_FILE',
    description: "Absolute path of the CA that signs the S3 endpoint's certificate (C249.1).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_SANDBOX_CHIP_FACES',
    description:
      'The generated faces of the sandbox test chip (C208.1), named only by the e2e stack.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_SEC_EDGAR_USER_AGENT',
    description:
      'The contact SEC EDGAR asks every client to send, while businessRegistry names sec-edgar.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_SEED_ORGANIZATION_NAME',
    description: "The dev seed organisation's name (seed:dev; refused in production mode).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['migrate'],
  },
  {
    name: 'OPENVERIFY_SEED_{ROLE}_EMAIL',
    prefix: 'OPENVERIFY_SEED_',
    description:
      "seed:dev's operator emails, one per seeded role (ADMIN, DEVELOPER, REVIEWER, VIEWER, MFA_ADMIN).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['migrate'],
  },
  {
    name: 'OPENVERIFY_SEED_{ROLE}_PASSWORD',
    prefix: 'OPENVERIFY_SEED_',
    description: "seed:dev's operator passwords, one per seeded role; development installs only.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['migrate'],
  },
  {
    name: 'OPENVERIFY_SMARTY_AUTH_ID',
    description: "Smarty's auth id, while addressVerification binds it.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_SMARTY_AUTH_TOKEN',
    description: "Smarty's auth token, while addressVerification binds it.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_SMTP_URL',
    description:
      'The SMTP server for invitations and notifications (smtp:// with STARTTLS or smtps://); unset, no mail is sent. Holds a credential.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_SSO_PRIVATE_ISSUERS',
    description:
      'Exact OIDC issuer URLs (at most 20) the outbound guard may reach on a private address in production (C248.3).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_TRUST_ANCHOR_REFRESH',
    description: "The worker's periodic trust-store refresh (C62.7).",
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker', 'dashboard'],
  },
  {
    name: 'OPENVERIFY_TRUST_PROXY',
    description:
      'Which reverse proxies the API trusts for the client address: false, true, a hop count, or addresses and CIDR ranges.',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_ACCOUNT_SID',
    description: "Twilio's account SID, required while sms is bound to twilio.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_API_KEY_SECRET',
    description: "Twilio's API key secret, required while sms is bound to twilio.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_API_KEY_SID',
    description: "Twilio's API key SID, required while sms is bound to twilio.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_FROM',
    description:
      'The E.164 number Twilio sends from; set it or the messaging service SID, not both.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID',
    description: "Twilio Lookup's account SID, while phoneIntelligence binds it.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET',
    description: "Twilio Lookup's API key secret, while phoneIntelligence binds it.",
    default: null,
    secret: true,
    fileForm: true,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID',
    description: "Twilio Lookup's API key SID, while phoneIntelligence binds it.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID',
    description: "Twilio's messaging service SID; set it or OPENVERIFY_TWILIO_FROM, not both.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_VISION_BLUR_THRESHOLD',
    description: "The image quality check's blur threshold.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_BRIGHTNESS_MAX',
    description: "The image quality check's highest brightness.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_BRIGHTNESS_MIN',
    description: "The image quality check's lowest brightness.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_CA_FILE',
    description: "Absolute path of the CA that signs the vision service's certificate (C249.1).",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_VISION_FACE_SCORE_THRESHOLD',
    description: 'The lowest YuNet confidence that counts as a face.',
    default: '0.9',
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_GLARE_THRESHOLD',
    description: "The image quality check's glare threshold.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_MAX_CONCURRENT_JOBS',
    description: 'Requests the vision service analyses at once.',
    default: '2',
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_MAX_IMAGE_PIXELS',
    description: 'The most pixels a decoded image may have.',
    default: '40000000',
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_MAX_QUEUED_JOBS',
    description: 'Requests that wait for a slot; beyond them the service answers 503.',
    default: '8',
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_MAX_UPLOAD_BYTES',
    description: 'The largest upload the vision service accepts.',
    default: '10485760',
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_MODELS_DIR',
    description: 'Where the vision service reads its fetched model weights.',
    default: 'models',
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_MODELS_MANIFEST',
    description:
      'models/manifest.json: when set (the vision image sets /app/models/manifest.json), vision refuses to start if a fetched model differs from its SHA-256 (C257.1, Workflow 11C).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['vision'],
  },
  {
    name: 'OPENVERIFY_VISION_SERVICE_TOKEN',
    description:
      'The shared token callers send to the vision service: at least 32 characters (required).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker', 'vision'],
  },
  {
    name: 'OPENVERIFY_VISION_URL',
    description:
      "The vision service's base URL (required in production; https with OPENVERIFY_VISION_CA_FILE).",
    default: 'http://127.0.0.1:8000',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WATCHLIST_REFRESH',
    description: "The worker's periodic watchlist refresh (C76.2).",
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS',
    description: 'How long entries removed from a list are kept (C76).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_WATCHLIST_SOURCES_DISABLED',
    description: 'Watchlist sources to turn off, comma-separated ids; it can only disable (C76).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED',
    description:
      'Allows an environment admin to opt in to the UN Security Council list with an audited acknowledgement of its terms (C254.1, Q10 granted); false locks the list on this install.',
    default: 'true',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WEBAUTHN_ORIGIN',
    description: 'The console origin WebAuthn ceremonies must come from.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_WEBAUTHN_RP_ID',
    description: "The WebAuthn relying party id: the console's domain, never an IP address.",
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_WEBAUTHN_RP_NAME',
    description: 'The relying party name shown by passkey prompts.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api'],
  },
  {
    name: 'OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS',
    description:
      'Lets webhooks and providers reach private addresses outside production; production always refuses them.',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WIKIDATA_SPARQL_URL',
    description: 'The Wikidata SPARQL endpoint pep:sync queries.',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_WIKIDATA_USER_AGENT',
    description: 'The contact Wikidata asks every client to send, for pep:sync (C80.1).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_WORKER_CONCURRENCY',
    description: 'Jobs each worker queue runs at once (1-64).',
    default: '4',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_WORKER_HEARTBEAT_FILE',
    description: 'The file the worker touches every 10 s for its exec probe (C250.2).',
    default: '/tmp/openverify-worker-heartbeat',
    secret: false,
    fileForm: false,
    processes: ['worker'],
  },
  {
    name: 'OPENVERIFY_WORKFLOW_CODE_ENABLED',
    description: 'Runs Evaluate Code workflow steps (C123); false ends such a step with an error.',
    default: 'true',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WORKFLOW_CODE_RUNNER',
    description:
      'Where Code steps run: pool (in the worker), socket:<path> (the code-runner service on a shared volume) or tcp:<host>:<port> (the code-runner service over the network, with OPENVERIFY_CODE_RUNNER_TOKEN; C263.6).',
    default: 'pool',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK',
    description:
      'Lets sandbox HTTPS workflow steps reach loopback test receivers; refused in production (C124.3).',
    default: 'false',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP',
    description:
      "An environment's workflow steps in flight by default (C117.8); clamped by OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX (C251.2).",
    default: '50',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'REDIS_URL',
    description:
      'Valkey (Redis protocol) connection for BullMQ, the rate limiter and the cache: redis:// or rediss:// (C249.1). Holds a credential.',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker'],
  },
  {
    name: 'S3_ACCESS_KEY_ID',
    description: 'The S3 access key id (required).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'S3_BUCKET',
    description: 'The bucket every file and object is stored in (required).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'S3_ENDPOINT',
    description:
      'The S3 API endpoint (http or https; https with OPENVERIFY_S3_CA_FILE for a private CA).',
    default: null,
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'S3_FORCE_PATH_STYLE',
    description: 'Path-style bucket addressing, which RustFS and most self-hosted S3 stores need.',
    default: 'true',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'S3_REGION',
    description: 'The S3 region name the client signs requests for.',
    default: 'us-east-1',
    secret: false,
    fileForm: false,
    processes: ['api', 'worker'],
  },
  {
    name: 'S3_SECRET_ACCESS_KEY',
    description: 'The S3 secret access key (required).',
    default: null,
    secret: true,
    fileForm: true,
    processes: ['api', 'worker'],
  },
];

/** Whether `entry` is a pattern entry. */
export function isPatternEntry(entry: ConfigVariable): boolean {
  return entry.prefix !== undefined;
}
