# Roles: controller and processor

This is not legal advice.

Not reviewed by counsel.

Who decides why and how identity data is processed when OpenVerify runs. Each statement about a role is an inference from the GDPR's definitions, for counsel to confirm for your deployment ([questions for counsel](questions-for-counsel.md)). The EU text was not re-read on 2026-11-20 (EUR-Lex returned no text, [S1](sources.md)); the UK text's Article 28 was ([S2](sources.md)).

## The operator is the controller

The organisation that deploys OpenVerify chooses the purposes (onboarding, fraud prevention, age checks), the templates and checks, the providers it binds, the retention windows and who may see what. That makes it the controller of the personal data the install processes, in our reading. OpenVerify's settings exist so that those choices are explicit and recorded: the consent and notice keys of each template, `signal-collection` and its bases, `biometric-lists-basis`, the retention windows ([retention](retention.md)), the roles and scopes ([settings](../settings/roles.md)), and every change in the audit log ([audit log](../settings/audit-log.md)).

## The operator as a processor for its own clients

An operator that runs verification for other businesses (each an organisation on its install) processes their end users' data on their behalf, and is then their processor. The UK GDPR's Article 28 (re-read on 2026-11-20) asks for a binding contract that sets out the processing and requires the processor, among other things, to act only on the controller's documented instructions, to keep staff bound to confidentiality, to secure the data, to use sub-processors only with the controller's authorisation, to help with the controller's duties and data subjects' requests, to delete or return the data at the end, and to allow audits. The EU's Article 28 has the same structure (not re-read, [S1](sources.md)).

What OpenVerify gives such an operator:

- **Separation per client.** Each client is an organisation with its own environments, keys, roles and settings; every API read of another organisation's object answers the same 404 (the cross-tenant probe of C240.7, partly built: KP11-10, open after Workflow 11F and carried to the next release).
- **Instructions in configuration.** The templates, workflows, retention windows and provider bindings record what the client asked for, with the audit log naming who changed them.
- **Deletion and return.** Redaction, the access export (C253) and the retention pass ([access requests](access-requests.md), [retention](retention.md)). Backups keep data until they expire ([retention](retention.md#backups)).
- **Sub-processors.** Every provider an install can bind is listed with what it receives ([recipients](recipients.md)); each one you bind is a sub-processor for your clients' data.

## A hosting operator between two of its clients (Connect)

Connect moves verified data from one organisation to another with the person's consent ([sharing](sharing.md)). When both organisations are clients of one hosting operator, that operator is processor for both, and in our reading it may move data between them only on both controllers' instructions: the source's (its connection, its consent step or attested consent) and the destination's (its activation of the connection with an agreement reference, C231.3).

- Connect is off on an install unless `OPENVERIFY_CONNECT_ENABLED` is `true` (default `false` in the images and the chart; C231.10). While it is off every Connect route answers the generic 404 and a `share-consent` step fails publish with `share_consent_connect_disabled`.
- Keep it off where your processor terms with either client do not allow such transfers. Even with it on, an organisation receives connections only after its own admin turns on `connect-inbound` (default off, audited).
- Whatever server holds both rows, a transfer between organisations established in different jurisdictions can be a restricted transfer ([sharing](sharing.md#transfers-between-jurisdictions)).

## The OpenVerify project is neither

The project publishes source code and documentation. It receives no data from any install: the code sends nothing to the project (no telemetry or call-home), and the Android SDK holds no analytics or crash reporter ([Android privacy](../android/privacy.md)). The downloads an install makes (sanctions lists, network data, chip trust anchors) are requests to their publishers, listed on [recipients](recipients.md). In our reading it is neither controller nor processor of any install's data. This is an inference for counsel to confirm ([questions for counsel](questions-for-counsel.md)).
