# Changelog

All notable changes to OpenVerify are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from its first release.

## [Unreleased]

The first public source release. No version has been tagged and no artifact is published to a registry yet ([`docs/release/`](docs/release/checklist.md) lists what remains before the first release).

### Added

- The API and worker: inquiries, sessions and one-time links, verifications, 89 checks, 11 report types, 19 signals, accounts, cases, lists, the relationship graph, transactions, workflows with sandboxed code steps, webhooks, Connect, analytics and exports.
- The verification flow (hosted, embedded or inline) in five languages, with themes and on-device capture guidance.
- The operator console: review, cases, the template and flow builder, the workflow editor, the graph explorer, analytics and organisation settings with SSO and MFA.
- The vision service: face detection and match, liveness, OCR, MRZ, PDF417 and document forensics.
- The Android SDK (Kotlin Multiplatform) with optional NFC chip and face modules and a demo app.
- The web SDKs `@openverify/node`, `@openverify/js` and `@openverify/react`.
- Production images, a Docker Compose profile and a Helm chart; the self-hosting, security and compliance documentation.
- Reading Quebec driver's licences from phone captures: higher capture resolution, PDF417 recovery on the card's back, the province's printed layout, a document blur threshold calibrated for phone cameras, and manual review instead of failure when a required field cannot be read.

[Unreleased]: https://github.com/hnalpha323/openverify/commits/main
