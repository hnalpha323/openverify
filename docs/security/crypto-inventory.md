# Cryptographic inventory and key management

This page lists every key and secret an OpenVerify install holds (C276.1; ASVS v5.0.0-11.1.1 and 11.1.2 are the requirements it answers, self-assessed in `docs/security/asvs-5.0.0-l2.csv`): what each is, its algorithm and length, where it is stored, which process reads it, how it is rotated and with which command, and its usage limit. It names where a secret lives, never a value.

It describes the code at its commit. Its record test, `packages/docs-tools/src/records/crypto-inventory.test.ts`, fails when a variable `apps/api/src/config-registry.ts` marks as a secret (pattern entries included), an HMAC label of `packages/db/src/blind-index.ts`, a token prefix, a data-key column or a sealed secret column is missing here, and when a cited path, `pnpm` command or variable does not exist. It cannot check that a sentence is right; a review reads it at each phase end.

## Key management policy

- **Generation.** The KEK and the blind-index key are 32 random bytes, base64 (`openssl rand -base64 32`, or the Node one-liner the error message prints). Peppers and service tokens are at least 32 bytes or characters. Every bearer token the platform issues is a fixed prefix and 256 random bits from the platform's CSPRNG (`packages/contracts/src/tokens.ts`).
- **Storage.** Every operator-supplied secret is an environment variable or, for every secret the API, the worker or migrate read, a file named by `<NAME>_FILE` (C249.2), mounted read-only; the chart mounts each process's secrets from its own Kubernetes Secret, and the compose `app` profile from files (`docs/self-hosting/secrets-and-rotation.md`). Nothing secret is committed: `.env.example` holds `change-me-...` placeholders, which the API and the worker refuse in production (`apps/api/src/config.ts`). There is no KMS or HSM adapter in this release (PLAN §3; the next release's).
- **Separation.** The KEK encrypts, the blind-index key indexes, the pepper hashes API keys: three keys, never derived from each other. Every HMAC under the blind-index key runs under an environment's own subkey and a label of its own, so two environments, or two uses, never share a keyed value.
- **What reads a secret.** Only the processes `config-registry.ts` lists for it; the chart gives each process only its own Secret (C264.3).
- **Logs.** No process logs a key, a token or a secret (`docs/security/logging.md`); error messages name a variable, never its value.
- **Rotation.** Each entry below says how. The KEK, the pepper, the flow-server token, webhook secrets, workflow signing secrets and API keys have a previous form that keeps working during a rotation; the blind-index key and the other service tokens do not, so their rotation is a planned restart.

## 1. Root keys and the pepper

| Key | What it protects | Algorithm and length | Stored in | Read by | Rotation | Usage limit |
|---|---|---|---|---|---|---|
| `OPENVERIFY_KEK` | Wraps every data key (envelope encryption, `packages/db/src/crypto.ts`) | AES-256-GCM, 32-byte key, 96-bit random IV per wrap; its key id (`kid`) is an HKDF-SHA-256 derivation, 8 bytes | Variable or `OPENVERIFY_KEK_FILE` | api, worker, migrate | Put the new key in `OPENVERIFY_KEK` and the old one in `OPENVERIFY_KEK_PREVIOUS`, restart the processes, run `pnpm --filter @openverify/api kek:rewrap` (`--dry-run` counts first; it resumes from its state file), then remove the old key once it reports `done`. Payloads are never decrypted: only each wrapped data key is re-wrapped | 2^32 wraps per KEK (random 96-bit IVs, NIST SP 800-38D): each value gets a new data key, so the budget counts values written under one KEK. Rotate long before it |
| `OPENVERIFY_KEK_PREVIOUS` | Retired KEKs, comma-separated, that may still unwrap | As the KEK | Variable or `OPENVERIFY_KEK_PREVIOUS_FILE` | api, worker, migrate | Emptied after `kek:rewrap` reports `done` | None of its own: nothing new is wrapped under it |
| Data keys (DEKs) | One value or one object each | AES-256-GCM, a fresh random 32-byte key per value; associated data binds a value to its column (`<table>.<column>`), to its row (`<table>.<column>#<row id>`, `packages/db/src/sealed.ts`) or to its file id | Wrapped under the KEK beside the ciphertext (`ov1.<kid>.<wrapped DEK>.<payload>`), or in a `wrapped_dek` column for an object in storage (section 6) | api, worker | Re-wrapped by `kek:rewrap`; never rotated on their own | One value each |
| OTP code key | The HMAC of each one-time code (`apps/api/src/services/otp/codes.ts`) | HMAC-SHA-256 under a key derived from the KEK by HKDF-SHA-256 (info `openverify/otp/v1`), per KEK id | Derived in memory, never stored | api, worker | With the KEK: a code made under a retired KEK verifies while that KEK is in `OPENVERIFY_KEK_PREVIOUS` | A code lives minutes |
| `OPENVERIFY_BLIND_INDEX_KEY` | Every keyed index (section 5): identification numbers, OTP destinations, wallet addresses, chip reads, report indexes, device HMACs, list keys, graph keys, transaction and case field keys, the audit address index | HMAC-SHA-256, 32-byte key; per-environment subkey `HMAC-SHA-256(key, "openverify/blind-index/v1\|<environment id>")`; its key id is `HMAC-SHA-256(key, "openverify/blind-index-key-id/v1")` truncated to 8 bytes, recorded beside each device HMAC (`key_id`) | Variable or `OPENVERIFY_BLIND_INDEX_KEY_FILE` | api, worker, migrate | No previous form. Stop the worker, set the new key, run `pnpm --filter @openverify/api blind-index:rebuild` (it decrypts every unredacted source with the KEK and recomputes each index; devices that meet a twin under the new key are merged, `rebuildDeviceIndexes`), then start the worker. Until it finishes, lookups miss | None in practice (HMAC); a key id that differs is never compared |
| `OPENVERIFY_API_KEY_PEPPER` | API keys, stored as `api_keys.secret_hash` (`packages/db/src/api-keys.ts`) | HMAC-SHA-256, a key of at least 32 bytes; its id (`api_keys.pepper_key_id`) is derived under `openverify/api-key-pepper-id/v1` | Variable or `OPENVERIFY_API_KEY_PEPPER_FILE` | api, worker | Move the current pepper to `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`, set a new one, restart. A key found under an earlier pepper is re-hashed under the current one when next used (C247.1). `pnpm --filter @openverify/api api-keys:pepper-status` counts the keys each pepper holds; remove an earlier pepper when its count is 0 (a key still under it stops working) | None in practice |
| `OPENVERIFY_API_KEY_PEPPER_PREVIOUS` | At most two earlier peppers, comma-separated | As the pepper | Variable or `OPENVERIFY_API_KEY_PEPPER_PREVIOUS_FILE` | api, worker | As above | None |

## 2. Tokens between the platform's own processes

| Token | Between | Length | Stored in | Rotation |
|---|---|---|---|---|
| `OPENVERIFY_VISION_SERVICE_TOKEN` | The API and the worker call vision with it; vision compares it in constant time (`services/vision/src/openverify_vision/auth.py`) | At least 32 characters | Variable or `OPENVERIFY_VISION_SERVICE_TOKEN_FILE`, in each of the three (vision: `services/vision/src/openverify_vision/settings.py`) | No previous form: set the new value in all three processes and restart them together; calls between them are refused until all three hold it |
| `OPENVERIFY_DASHBOARD_BFF_TOKEN` | The console's server sends it to the API on dashboard routes | At least 32 characters | Variable or `OPENVERIFY_DASHBOARD_BFF_TOKEN_FILE`, in both (console: `apps/dashboard/src/lib/secret-files.ts`) | No previous form: restart the API and the console together |
| `OPENVERIFY_FLOW_SERVER_TOKEN` | The flow server reads embed policies from the API's internal route with it; the API compares it in constant time (`apps/api/src/auth/flow-server-token.ts`) | At least 32 characters | Variable or `OPENVERIFY_FLOW_SERVER_TOKEN_FILE`, in both | In this order: give the API the new token and the old one as `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` and restart it; give the flow server the new token and restart it; remove `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` from the API and restart it. Without a token every `/embed/` page answers `frame-ancestors 'none'` |
| `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` | Accepted by the API during that rotation | As above | Variable or `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS_FILE` (api only) | Removed at the rotation's end |
| `OPENVERIFY_CODE_RUNNER_TOKEN` | The worker and the code runner on the `tcp:` transport (`packages/workflow-engine/src/code-runner/socket-server.ts` compares it in constant time) | At least 32 bytes | Variable or `OPENVERIFY_CODE_RUNNER_TOKEN_FILE` | No previous form: restart the worker and the code runner together; no Evaluate Code step runs in between |

## 3. Credentials of the data stores and the providers

Each is the operator's credential at another system; OpenVerify only reads it. Rotate it at its issuer, put the new value in the variable or its file, and restart the processes that read it. Every one of them is a `secret: true` entry of `apps/api/src/config-registry.ts` with a `_FILE` form.

| Variable | What it is | Read by | Notes |
|---|---|---|---|
| `DATABASE_URL` | The runtime role's Postgres connection, with its password | api, worker, migrate | The runtime role cannot create objects; its grants come from `pnpm --filter @openverify/api db:grant-runtime`, run after every `db:migrate` (C249.3, `packages/db/src/runtime-role.ts`) |
| `OPENVERIFY_MIGRATION_DATABASE_URL` | The migration role's connection, which owns the schema | migrate | Used by `db:migrate`, `seed:dev` and `kek:rewrap`; unset, they fall back to `DATABASE_URL` with a production warning. Two roles, two passwords: rotate each on its own |
| `REDIS_URL` | Valkey's connection (`redis://` or `rediss://`), with its ACL user and password | api, worker | BullMQ, the rate limiter, the login limiter and the cache share it |
| `S3_SECRET_ACCESS_KEY` | The object store's secret key (its id, `S3_ACCESS_KEY_ID`, is not a secret) | api, worker | Objects are encrypted before they reach the store (section 6), so the store sees ciphertext only |
| `OPENVERIFY_SMTP_URL` | The SMTP server's URL with its credential | api, worker | Unset, no mail is sent |
| `OPENVERIFY_TWILIO_API_KEY_SECRET` | Twilio's API key secret, while SMS is bound to Twilio | api, worker | Its SID, `OPENVERIFY_TWILIO_API_KEY_SID`, is not a secret |
| `OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET` | Twilio Lookup's secret, while phone intelligence binds it | worker | |
| `OPENVERIFY_COMPANIES_HOUSE_API_KEY` | The production environments' Companies House key | worker | |
| `OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY` | The sandbox environments' Companies House key | worker | |
| `OPENVERIFY_HIBP_API_KEY` | The Have I Been Pwned key, while email intelligence binds it | worker | |
| `OPENVERIFY_SMARTY_AUTH_TOKEN` | Smarty's auth token, while address verification binds it | worker | Its id, `OPENVERIFY_SMARTY_AUTH_ID`, is not a secret |
| `OPENVERIFY_EU_FSF_TOKEN` | The EU financial sanctions file token | worker | Left commented out in `.env.example` |
| `OPENVERIFY_EVM_RPC_URLS` | EVM node URLs per chain, which often carry an API key | worker | |
| `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | The Google service-account key that decodes Play Integrity tokens (the `integrity-decode` job, `apps/api/src/jobs/integrity/`) | worker | Rotate the key in the operator's Google Cloud project and replace the file. The verdict is held to `OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME` and the app-signing certificate digests of `OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS`, which are not secrets. OpenVerify ships no Google code (Phase 10 P3, declined): the token comes from the operator's own app |
| `OPENVERIFY_SEED_{ROLE}_PASSWORD` | `seed:dev`'s operator passwords, one per seeded role | migrate | Development installs only (`pnpm --filter @openverify/api seed:dev`) |

TLS material is the operator's: certificates and their private keys live at the TLS terminator or in the data stores, never in OpenVerify. OpenVerify reads only the certificate authorities it verifies against: `OPENVERIFY_POSTGRES_CA_FILE` (`sslmode=verify-full`), `OPENVERIFY_REDIS_CA_FILE` (`rediss://`), `OPENVERIFY_S3_CA_FILE` and `OPENVERIFY_VISION_CA_FILE` (C249.1). They are not secrets; a production process warns on a plain-text connection (`docs/self-hosting/database.md`, `docs/self-hosting/valkey.md`).

## 4. Secrets and credentials stored in the database

| Where | What | Algorithm | Rotation and lifetime |
|---|---|---|---|
| `webhooks.secret` | A webhook's signing secret, `wbhsec_` and 256 random bits, returned once and afterwards shown only by its last four characters | Sealed (column-bound); each delivery is signed `t=<unix seconds>,v1=<hex HMAC-SHA-256(secret, "<t>.<raw body>")>` in the `openverify-signature` header (`packages/contracts/src/webhooks.ts`) | `POST /api/v1/webhooks/:id/rotate-secret` answers the new secret once; the previous one keeps signing beside it (a second `v1=`) for 24 hours by default, at most 7 days (`docs/settings/webhooks.md`) |
| `webhooks.previous_secret` | The previous signing secret during that window | Sealed (row-bound) | Verifies only until the webhook's `previous-secret-expires-at` |
| `webhooks.custom_headers` | Headers sent with each delivery, which carry the receiver's credentials | Sealed (row-bound); write-only through the API | Replaced by the webhook's update |
| `mfa_factors.totp_secret` | An operator's TOTP secret, 20 random bytes | Sealed (row-bound); RFC 6238 HMAC-SHA-1, 6 digits, 30-second steps (`apps/api/src/operator-auth/totp.ts`) | Re-enrolment by the user, or `pnpm --filter @openverify/api user:reset-mfa` by an operator of the host (which ends the user's sessions and writes a system audit entry) |
| `mfa_factors` (WebAuthn) | A security key's credential id, public key and signature counter | Public keys, not secrets; each registration and login challenge is stored as a digest only (`webauthn_registration_challenges.challenge_hash`, `mfa_challenges.webauthn_challenge_hash`) | Removed by the user or by `user:reset-mfa` |
| `mfa_recovery_codes.code_hash` | Recovery codes, each usable once | Argon2id | Regenerating replaces them all |
| `users.password_hash` | Operators' passwords | Argon2id, 19 MiB of memory, 2 iterations, parallelism 1, a 16-byte random salt (`apps/api/src/operator-auth/password-hasher.ts`) | Changed by the user; a change or reset ends the user's sessions (C245.3) |
| `workflow_secret_values.value` | A workflow secret's value per environment (an HTTPS action's credential, a signing secret) | Sealed (row-bound) | `POST .../rotate` replaces it; for a signing secret the previous value keeps verifying for up to 24 hours (`packages/contracts/src/workflow-secrets.ts`) |
| `workflow_secret_values.previous_value` | The previous value during that window | Sealed (row-bound) | Verifies only until the value's `previous-expires-at` |
| `sso_providers.client_secret` | An OIDC identity provider's client secret | Sealed, bound to the provider's id (C248.3) | Replaced by updating the provider in the console's SSO settings (`docs/self-hosting/sso.md`) |
| `sso_login_states.nonce` | The OIDC nonce of one sign-in | Sealed, bound to the browser binding's digest | Single use; the record lives 10 minutes and the C16 pass deletes it a day after it expired |
| `sso_login_states.code_verifier` | The PKCE verifier of one sign-in | Sealed, as above | As above |
| `api_keys.secret_hash` | API keys, `ov_sbx_` (sandbox) or `ov_prod_` (production) and 256 random bits; `token_prefix` keeps the prefix and the first four secret characters for recognition | HMAC-SHA-256 under the pepper (section 1) | `POST /api/v1/api-keys/:id/rotate` makes a new key and ends the old one in one transaction; the old token keeps working for `previous-expires-in-seconds` (0 ends it now; `docs/settings/api-keys.md`) |

## 5. Token families and one-time secrets

Every token is a fixed prefix and 256 random bits in unpadded base64url (`packages/contracts/src/tokens.ts`). A server stores only a digest and compares in constant time; a token is never in a log, and a URL carries one only where its section says so.

| Prefix or kind | What it is | Stored as | Lifetime |
|---|---|---|---|
| `ovs_` | A hosted-flow or Android session token | SHA-256 (`inquiry_sessions.token_hash`) | 24 hours |
| `ovu_` | A console session token, in the console's cookie | SHA-256 (`user_sessions.token_hash`, `packages/db/src/tokens.ts`) | `OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS` without a request (default 30 minutes) and `OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS` in all (default 12 hours); deleted 30 days past expiry |
| `ovo_` | A one-time link token | SHA-256 (`one_time_links.token_hash`) | 24 hours by default, 5 minutes to 30 days, never past the inquiry's expiry; single use |
| `ovm_` | An MFA challenge token, after a correct password | SHA-256 (`mfa_challenges.token_hash`) | 5 minutes; five wrong codes revoke it |
| `ovi_` | An invitation token, sent only by email | SHA-256 (`users.invitation_token_hash`) | 7 days |
| `ovh_` | A device handoff token (C96.2), in a URL fragment held in memory only | SHA-256 (`handoff_tokens.token_hash`); the confirmation code as a SHA-256 over the token and the code (`confirmation_code_hash`) | A QR token 5 minutes by default (2 to 15), an email or SMS one 15 minutes (5 to 60), never past the inquiry's expiry; single use; deleted 30 days past expiry |
| `wbhsec_` | A webhook signing secret | Sealed (section 4) | Until rotated |
| `ov_sbx_`, `ov_prod_` | An API key of a sandbox or a production environment | HMAC-SHA-256 under the pepper (section 4) | Until it expires or is ended |
| `ovsb_` | An SSO browser binding, in a `__Host-` cookie (`packages/contracts/src/sso.ts`) | SHA-256 only | 10 minutes, single use |
| One-time code | An OTP of six to ten digits, uniform from the CSPRNG | `HMAC-SHA-256(K_otp, "otp/v1\|" + verification + channel + destination + code)` under the OTP code key (section 1) | Minutes; the code is never stored, logged or returned |
| `cnst_` | A Connect share token's id | Plain: the id is a handle, not a secret (C232.8); redeeming needs the destination's own key with `connect-share-tokens:redeem` | 60 seconds to `share-token-max-seconds` (default 21 days); single use under a row lock |

## 6. HMAC labels under the blind-index key

Each keyed value is `HMAC-SHA-256(environment subkey, "<label>|<input>")`, 64 lower-case hex, so equal inputs match inside one environment and nothing links across environments without the key (`packages/db/src/blind-index.ts`). All are re-keyed by `pnpm --filter @openverify/api blind-index:rebuild` after the key changes (section 1). Matching on these values is exact: an HMAC reveals nothing about a near miss.

| Label | Indexes |
|---|---|
| `openverify/blind-index/v1` | The environment subkey's derivation, and the identification-number index of a government ID (C31.8) |
| `openverify/blind-index-key-id/v1` | The blind-index key's id (C94.4), recorded beside each device HMAC and fingerprint list item so a rotated key is never compared |
| `openverify/otp-destination/v1` | An OTP's destination, for its per-destination limits (C53.2) |
| `openverify/crypto-address/v1` | A wallet address (C53.2) |
| `openverify/chip-sod/v1` | A chip's document security object signature (C53.3) |
| `openverify/chip-document-number/v1` | A chip's document number (C53.3) |
| `openverify/report-crypto-address/v1` | A report's screened wallet address (C73.4) |
| `openverify/report-match-entry/v1` | A report match's list entry (C73.4) |
| `openverify/report-match-evidence/v1` | A report match's evidence (C73.4) |
| `openverify/browser-fingerprint/v1` | A device's strict browser fingerprint (C94.4) |
| `openverify/device-class/v1` | A web device class, shared by many people (C94.4) |
| `openverify/android-id/v1` | A device's `ANDROID_ID` (C94.4) |
| `openverify/account-identifier/v1` | An account's declared identifier field, found through a reference id (C127.6) |
| `openverify/identifier-string/v1` | A string list item (C98.2) |
| `openverify/identifier-email/v1` | An email address list item |
| `openverify/identifier-email-domain/v1` | An email domain list item |
| `openverify/identifier-phone/v1` | A phone number list item |
| `openverify/identifier-government-id-number/v1` | A government ID number list item |
| `openverify/identifier-name/v1` | A name list item |
| `openverify/identifier-name-last/v1` | A last-name list item |
| `openverify/identifier-ip/v1` | An IP address list item |
| `openverify/identifier-ip-range/v1` | An IP range list item |
| `openverify/identifier-country/v1` | A country list item |
| `openverify/identifier-geolocation/v1` | A geolocation list item |
| `openverify/identifier-browser-fingerprint/v1` | A browser fingerprint list item: an HMAC of the stored device HMAC, never of the raw fingerprint |
| `openverify/identifier-device-fingerprint/v1` | A device fingerprint list item, likewise over the stored device HMAC |
| `openverify/identifier-field/v1` | A field list item |
| `openverify/identifier-reference-id/v1` | A graph key: a reference id (C101.2) |
| `openverify/identifier-name-birthdate/v1` | A graph key: a name with a birthdate |
| `openverify/identifier-address/v1` | A graph key: an address |
| `openverify/identifier-postal-code/v1` | A graph key: a postal code |
| `openverify/identifier-birthdate/v1` | A graph key: a birthdate |
| `openverify/identifier-transaction-field/v1` | A transaction's searchable field (`transaction_field_keys.value_key`, C105.4) |
| `openverify/identifier-case-field/v1` | A case's searchable field (C136.4) |
| `openverify/audit-ip/v1` | An audit entry's address (`audit_log_ip_index.ip_hmac`, C168.6) |

Two more keys are derived from the blind-index key for values that never reach the database: the login limiter's Valkey keys, `HMAC-SHA-256` of each address and email under a subkey labelled `openverify/login-limit/v1` (`apps/api/src/operator-auth/valkey-login-rate-limiter.ts`), and the per-recipient counters of workflow messages under `openverify/workflow-recipient/v1` (`apps/api/src/workflows/actions/messaging/messenger.ts`). Both expire with their windows, so a key change only resets their counts.

## 7. Data keys of objects in storage

An object (an upload, an export, a rendition, a theme asset) is written to the S3 store as `IV || AES-256-GCM(data key, bytes) || tag`, with associated data `ov1-bytes:<context>` (the object's id), so an object cannot be swapped between records; its data key is wrapped under the KEK in a column of its row (`packages/db/src/crypto.ts`, `encryptBytes`). `kek:rewrap` re-wraps these columns and never touches the objects. Each lives and dies with its row: a redaction or a retention deletion removes the object and the row together.

| Column | The object |
|---|---|
| `files.wrapped_dek` | An uploaded file: a document image, a selfie, a PDF |
| `account_exports.wrapped_dek` | An access export's sealed manifest (C253.2); no file is copied |
| `exports.wrapped_dek` | A principal's 24-hour CSV or JSON export (C166.1) |
| `report_bulk_jobs.wrapped_dek` | A bulk report job's uploaded CSV (C166.5) |
| `importers.wrapped_dek` | A list importer's uploaded file (C100.2) |
| `list_item_backgrounds.masked_file_wrapped_dek` | A background list item's masked image (C98.1) |
| `transaction_files.wrapped_dek` | A transaction's file field (C105.1) |
| `workflow_run_files.wrapped_dek` | A workflow run's trigger file (C118.3) |
| `case_attachments.wrapped_dek` | A case attachment (C135.2) |
| `case_exports.wrapped_dek` | A case export (C138.1) |
| `rendition_pages.wrapped_dek` | A metadata-free rendition page vision produced (C135.3) |
| `theme_assets.wrapped_dek` | A theme's logo or font (C160.6) |

## 8. Digests that are not keys

These are SHA-256 digests the platform stores or checks in the clear; none is a secret, and none can be reversed into the value it names except by guessing a value of low entropy.

- **Connect** (Workflow 11A). A flow consent text is stored once per digest in `consent_texts`, its body sealed and bound to `<environment id>:<sha256>`; each consent record keeps the SHA-256 of the logical text shown (`consent_records.text_sha256`, and `biometric_text_sha256` for a separate biometric text) beside its sealed evidence (the `operator-and-audit` rows of `docs/security/data-classification.md`); a connection's agreement reference is sealed (`connect_connections.agreement_reference`). A share token's id is a handle (section 5).
- **Consent texts on a client.** The web flow and the Android SDK can send the SHA-256 of each consent text as rendered, the copy's source and a catalog version (`android-<SDK version>-<16 hex digits of a SHA-256 over the consent texts>`, `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/consent/ConsentDigests.kt`); the server checks each digest a client sends against its stored texts in the consent's transaction and refuses a mismatch (C162.9, `apps/api/src/services/templates/consent-texts.ts`); a consent sent without digests is accepted unmatched. No column keeps the client's digests or catalog version: the session's consent holds its text keys, locale, address and user agent (`packages/db/src/tables/inquiries.ts`), and a Connect consent record holds the digest the server computes itself.
- **Files.** An importer's file (`importers.file_sha256`), a transaction file (`transaction_files.sha256`) and each file an access export lists carry their SHA-256 for integrity; the stored API log of an importer's JSON body keeps only the file's length and SHA-256.
- **Key ids.** The KEK's `kid`, the blind-index key's id and the pepper's id name a key without revealing it (sections 1 and 6).
- **Downloads.** Every model, dataset, fixture and standard the fetch scripts download is pinned by URL, size and SHA-256 and written only after its digest matches (`scripts/fetch_models.py`, `scripts/fetch_data.py`, `scripts/fetch_fixtures.py`, `scripts/fetch_asvs.py`, `scripts/fetch_masvs.py`); every tool the installers place is checked against its pinned SHA-256 (`infra/scripts/lib/install-common.sh`).

## 9. Release artifacts

- **Nothing of this release is signed or published.** `.github/workflows/release.yml` builds, scans and stages every artifact with a `SHA256SUMS` file; its `publish` job, written with cosign signatures, SBOM attestations and build provenance, runs only when the repository variable `OPENVERIFY_PUBLISH` is `'true'` in the `release` environment, which waits on the owner's registry, identity and visibility decisions (Q1, Q2, Q3; C262). That workflow is defined and has never been run (KP10-59). Its use of cosign today is to check the signatures of the tools it downloads, not to sign anything of ours.
- **Android.** The staged Maven repository (`android/build/staging-repo/`, written by `publishAllPublicationsToStagingRepository`) holds every file with `.md5`, `.sha1`, `.sha256` and `.sha512` checksums, which `android/scripts/check-staged-repository.py` holds; no `.asc` signature is made, because nothing is signed without the owner's key, and nothing is published to Maven Central (Phase 10 P4 pending, KP10-60). `.github/workflows/android-release.yml` is defined and has never been run.
- **Images.** The five production images' digests recorded in Workflows 11C and 11D are local builds, not release artifacts; a release's digests and checksums come from `release.yml`'s first staged run, which is pending.

## 10. Limits and open items

- No KMS or HSM: the KEK, the blind-index key and the pepper are held by the processes that read them, as variables or files. A host that can read a process's environment or its mounted files can read them.
- The blind-index key and the vision, console and code-runner tokens have no previous form; their rotation is a planned restart (sections 1 and 2).
- Phase 1's column-bound ciphertexts (`inquiries.fields`, `events.payload`, `audit_logs.ip`, `webhooks.secret` and the consent's address and user agent in `inquiry_sessions.consent`) are bound to their column, not to their row (accepted in Phase 1, B7-T1); every later sealed column is row-bound.
- A database backup holds ciphertext and digests: it is useless without the KEK, and the KEK's own backup, kept apart from the database's, is the operator's (`docs/self-hosting/backups-and-restore.md`).
- TOTP uses HMAC-SHA-1, as RFC 6238 and authenticator apps expect; its strength rests on the secret's 160 bits, not on SHA-1's collision resistance.
