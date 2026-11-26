{{- /*
Workflow 11C Stage 1a (contracts-11c): the security helpers' names and arguments, frozen. chart-11c's
templates include them; chart-policy-11c fills each one (C264), test-first under tests/, and owns
this file after Stage 1a. Two helpers of its own sit beside the frozen twelve (openverify.secretSources
and openverify.caSources), which the Secret and CA helpers share.

Every helper takes a dict with "root" (the chart's top context, `$`); the others add the keys named.
"process" is one of api, worker, migrate, dashboard, flow, codeRunner, vision, modelsFetch.
*/ -}}

{{- /*
openverify.podSecurityContext (dict "root" $ "uid" <int> "gid" <int>): a pod's securityContext body
under the restricted Pod Security Standard (C264.1): runAsNonRoot, a non-zero runAsUser and runAsGroup,
fsGroup equal to the process's gid (so a Secret mounted 0440 is readable by the process, C264.3), and
seccompProfile RuntimeDefault. A uid or gid of 0 fails the render.
*/ -}}
{{- define "openverify.podSecurityContext" -}}
{{- if or (eq (int .uid) 0) (eq (int .gid) 0) -}}
{{- fail "openverify.podSecurityContext: the uid and gid must be non-zero (restricted Pod Security, C264.1)" -}}
{{- end -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .gid }}
fsGroup: {{ .gid }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- /*
openverify.containerSecurityContext (dict "root" $): a container's securityContext body under the
restricted profile (C264.1): no privilege escalation, every capability dropped, not privileged, a
read-only root (the one writable path is the /tmp emptyDir), non-root, seccomp RuntimeDefault.
*/ -}}
{{- define "openverify.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
privileged: false
readOnlyRootFilesystem: true
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- /*
openverify.tmpVolume (dict "root" $) and openverify.tmpVolumeMount (dict "root" $): the one writable
path, an emptyDir at /tmp (C257.1, C264.1), as a volumes entry and a volumeMounts entry.
*/ -}}
{{- define "openverify.tmpVolume" -}}
- name: tmp
  emptyDir: {}
{{- end -}}
{{- define "openverify.tmpVolumeMount" -}}
- name: tmp
  mountPath: /tmp
{{- end -}}

{{- /*
openverify.secretSources (dict "root" $ "process" <name>), chart-policy-11c's own helper beside the
frozen ones: the process's Secret sources as YAML, {sources: [{secret, items: [{key, path}]}],
files: [<NAME>], keyRefs: [{name, secret, key}]}. Its own Secret (secrets.<process>.existingSecret,
each name of `keys` at its own name) comes first, then the data stores it reads, each under the
variable's name (C264.3):
  api, worker  external.postgres (DATABASE_URL), external.valkey (REDIS_URL), external.s3
               (S3_SECRET_ACCESS_KEY; S3_ACCESS_KEY_ID is no secret and has no _FILE form, so it is
               the one keyRef), external.smtp (OPENVERIFY_SMTP_URL)
  migrate      external.postgres (DATABASE_URL, which its configuration requires) and
               external.postgres.migrationSecret (OPENVERIFY_MIGRATION_DATABASE_URL, C249.3)
The names a process may hold are the configuration registry's secrets for that process
(apps/api/src/config-registry.ts, `processes`; held equal by ci/tests/chart-policy.test.sh), less the
data stores' variables, which come only from external.<store>: a name the process does not read, or a
store's variable among its own keys, fails the render.
*/ -}}
{{- define "openverify.secretSources" -}}
{{- $v := .root.Values -}}
{{- $p := .process -}}
{{- $reads := dict
  "api" (list "OPENVERIFY_API_KEY_PEPPER" "OPENVERIFY_API_KEY_PEPPER_PREVIOUS" "OPENVERIFY_BLIND_INDEX_KEY" "OPENVERIFY_DASHBOARD_BFF_TOKEN" "OPENVERIFY_FLOW_SERVER_TOKEN" "OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS" "OPENVERIFY_KEK" "OPENVERIFY_KEK_PREVIOUS" "OPENVERIFY_TWILIO_API_KEY_SECRET" "OPENVERIFY_VISION_SERVICE_TOKEN")
  "worker" (list "OPENVERIFY_API_KEY_PEPPER" "OPENVERIFY_API_KEY_PEPPER_PREVIOUS" "OPENVERIFY_BLIND_INDEX_KEY" "OPENVERIFY_CODE_RUNNER_TOKEN" "OPENVERIFY_COMPANIES_HOUSE_API_KEY" "OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY" "OPENVERIFY_EU_FSF_TOKEN" "OPENVERIFY_EVM_RPC_URLS" "OPENVERIFY_HIBP_API_KEY" "OPENVERIFY_KEK" "OPENVERIFY_KEK_PREVIOUS" "OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON" "OPENVERIFY_SMARTY_AUTH_TOKEN" "OPENVERIFY_TWILIO_API_KEY_SECRET" "OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET" "OPENVERIFY_VISION_SERVICE_TOKEN")
  "migrate" (list "OPENVERIFY_BLIND_INDEX_KEY" "OPENVERIFY_KEK" "OPENVERIFY_KEK_PREVIOUS")
  "dashboard" (list "OPENVERIFY_DASHBOARD_BFF_TOKEN")
  "flow" (list "OPENVERIFY_FLOW_SERVER_TOKEN")
  "codeRunner" (list "OPENVERIFY_CODE_RUNNER_TOKEN")
  "vision" (list "OPENVERIFY_VISION_SERVICE_TOKEN") -}}
{{- $patterns := dict "migrate" (list "^OPENVERIFY_SEED_[A-Z0-9_]+_PASSWORD$") -}}
{{- $storeOf := dict "DATABASE_URL" "postgres" "OPENVERIFY_MIGRATION_DATABASE_URL" "postgres" "REDIS_URL" "valkey" "S3_SECRET_ACCESS_KEY" "s3" "S3_ACCESS_KEY_ID" "s3" "OPENVERIFY_SMTP_URL" "smtp" -}}
{{- $label := dict "api" "the API" "worker" "the worker" "migrate" "migrate" "dashboard" "the console" "flow" "the flow server" "codeRunner" "the code runner" "vision" "vision" -}}
{{- $sources := list -}}
{{- $files := list -}}
{{- $keyRefs := list -}}
{{- if hasKey $reads $p -}}
{{- $block := index $v.secrets $p -}}
{{- range $name := $block.keys -}}
{{- if hasKey $storeOf $name -}}
{{- fail (printf "secrets.%s.keys names %s, which comes from external.%s (C264.3)" $p $name (index $storeOf $name)) -}}
{{- end -}}
{{- $allowed := has $name (index $reads $p) -}}
{{- range $pattern := (index $patterns $p | default list) -}}
{{- if regexMatch $pattern $name }}{{ $allowed = true }}{{ end -}}
{{- end -}}
{{- if not $allowed -}}
{{- fail (printf "secrets.%s.keys names %s, which %s does not read (apps/api/src/config-registry.ts, C264.3)" $p $name (index $label $p)) -}}
{{- end -}}
{{- end -}}
{{- if and $block.existingSecret $block.keys -}}
{{- $items := list -}}
{{- range $name := $block.keys -}}
{{- $items = append $items (dict "key" $name "path" $name) -}}
{{- $files = append $files $name -}}
{{- end -}}
{{- $sources = append $sources (dict "secret" $block.existingSecret "items" $items) -}}
{{- end -}}
{{- $stores := list -}}
{{- if has $p (list "api" "worker") -}}
{{- $stores = list
  (list $v.external.postgres.existingSecret $v.external.postgres.key "DATABASE_URL")
  (list $v.external.valkey.existingSecret $v.external.valkey.key "REDIS_URL")
  (list $v.external.s3.existingSecret "S3_SECRET_ACCESS_KEY" "S3_SECRET_ACCESS_KEY")
  (list $v.external.smtp.existingSecret $v.external.smtp.key "OPENVERIFY_SMTP_URL") -}}
{{- if $v.external.s3.existingSecret -}}
{{- $keyRefs = append $keyRefs (dict "name" "S3_ACCESS_KEY_ID" "secret" $v.external.s3.existingSecret "key" "S3_ACCESS_KEY_ID") -}}
{{- end -}}
{{- else if eq $p "migrate" -}}
{{- $stores = list
  (list $v.external.postgres.existingSecret $v.external.postgres.key "DATABASE_URL")
  (list $v.external.postgres.migrationSecret $v.external.postgres.migrationKey "OPENVERIFY_MIGRATION_DATABASE_URL") -}}
{{- end -}}
{{- range $store := $stores -}}
{{- if index $store 0 -}}
{{- $sources = append $sources (dict "secret" (index $store 0) "items" (list (dict "key" (index $store 1) "path" (index $store 2)))) -}}
{{- $files = append $files (index $store 2) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- toYaml (dict "sources" $sources "files" $files "keyRefs" $keyRefs) -}}
{{- end -}}

{{- /*
openverify.secretVolume (dict "root" $ "process" <name>): one projected volume `secrets` holding the
process's own Secret and the data store Secrets it reads (openverify.secretSources), defaultMode 0440
(288): readable by the pod's fsGroup, which is the process's gid, and by nobody else (C264.3, review
P18). openverify.secretVolumeMounts (same arguments): its mount at /run/secrets/openverify, read-only.
openverify.secretFileEnv (same arguments): `<NAME>_FILE` = /run/secrets/openverify/<NAME> for each
file (C249.2: the API, the worker and migrate resolve them through resolveSecretFiles, the flow
server, the console, vision and the runner through images-11c's reader), then S3_ACCESS_KEY_ID from
the S3 Secret. Each renders nothing when the process has no Secret. The chart creates no Secret.
*/ -}}
{{- define "openverify.secretVolume" -}}
{{- $s := fromYaml (include "openverify.secretSources" .) -}}
{{- if $s.sources }}
- name: secrets
  projected:
    defaultMode: 288
    sources:
      {{- range $source := $s.sources }}
      - secret:
          name: {{ $source.secret }}
          items:
            {{- range $item := $source.items }}
            - key: {{ $item.key }}
              path: {{ $item.path }}
            {{- end }}
      {{- end }}
{{- end }}
{{- end -}}
{{- define "openverify.secretVolumeMounts" -}}
{{- $s := fromYaml (include "openverify.secretSources" .) -}}
{{- if $s.sources }}
- name: secrets
  mountPath: /run/secrets/openverify
  readOnly: true
{{- end }}
{{- end -}}
{{- define "openverify.secretFileEnv" -}}
{{- $s := fromYaml (include "openverify.secretSources" .) -}}
{{- range $name := $s.files }}
- name: {{ $name }}_FILE
  value: /run/secrets/openverify/{{ $name }}
{{- end }}
{{- range $ref := $s.keyRefs }}
- name: {{ $ref.name }}
  valueFrom:
    secretKeyRef:
      name: {{ $ref.secret }}
      key: {{ $ref.key }}
{{- end }}
{{- end -}}

{{- /*
openverify.caSources (dict "root" $ "process" <name>), chart-policy-11c's own helper beside the frozen
ones: the stores whose CA source (external.<store>.ca: {configMap} or {secret}, with `key`, default
ca.crt) is set and which the process reads, as YAML [{store, file, variable, configMap|secret, key}]:
postgres (OPENVERIFY_POSTGRES_CA_FILE) and valkey (OPENVERIFY_REDIS_CA_FILE) for the API, the worker
and migrate; s3 (OPENVERIFY_S3_CA_FILE) for the API and the worker (the registry's processes).
*/ -}}
{{- define "openverify.caSources" -}}
{{- $v := .root.Values -}}
{{- $p := .process -}}
{{- $out := list -}}
{{- range $store := list (list "postgres" "OPENVERIFY_POSTGRES_CA_FILE" (list "api" "worker" "migrate")) (list "valkey" "OPENVERIFY_REDIS_CA_FILE" (list "api" "worker" "migrate")) (list "s3" "OPENVERIFY_S3_CA_FILE" (list "api" "worker")) -}}
{{- $ca := (index $v.external (index $store 0)).ca | default dict -}}
{{- if and (has $p (index $store 2)) (or $ca.configMap $ca.secret) -}}
{{- $entry := dict "store" (index $store 0) "file" (printf "%s.pem" (index $store 0)) "variable" (index $store 1) "key" ($ca.key | default "ca.crt") -}}
{{- if $ca.configMap }}{{ $_ := set $entry "configMap" $ca.configMap }}{{ else }}{{ $_ := set $entry "secret" $ca.secret }}{{ end -}}
{{- $out = append $out $entry -}}
{{- end -}}
{{- end -}}
{{- toYaml (dict "cas" $out) -}}
{{- end -}}

{{- /*
openverify.caVolumes (dict "root" $ "process" <name>), openverify.caVolumeMounts (same) and
openverify.caFileEnv (same): one projected volume `ca` (mode 0444, 292: certificates are public) with
each CA the process reads at <store>.pem, mounted read-only at /etc/openverify/ca, and
OPENVERIFY_{POSTGRES,REDIS,S3}_CA_FILE naming each file (C249.1). Nothing when no CA is set.
*/ -}}
{{- define "openverify.caVolumes" -}}
{{- $s := fromYaml (include "openverify.caSources" .) -}}
{{- if $s.cas }}
- name: ca
  projected:
    defaultMode: 292
    sources:
      {{- range $ca := $s.cas }}
      - {{ ternary "configMap" "secret" (hasKey $ca "configMap") }}:
          name: {{ $ca.configMap | default $ca.secret }}
          items:
            - key: {{ $ca.key }}
              path: {{ $ca.file }}
      {{- end }}
{{- end }}
{{- end -}}
{{- define "openverify.caVolumeMounts" -}}
{{- $s := fromYaml (include "openverify.caSources" .) -}}
{{- if $s.cas }}
- name: ca
  mountPath: /etc/openverify/ca
  readOnly: true
{{- end }}
{{- end -}}
{{- define "openverify.caFileEnv" -}}
{{- $s := fromYaml (include "openverify.caSources" .) -}}
{{- range $ca := $s.cas }}
- name: {{ $ca.variable }}
  value: /etc/openverify/ca/{{ $ca.file }}
{{- end }}
{{- end -}}

{{- /*
openverify.ingressAnnotations (dict "root" $ "host" <api|flow|dashboard> "path" <default|import|transactionFile>):
the annotations of one host's Ingress for one path class (C264.5):
  - TLS required: plain HTTP is redirected to HTTPS (nginx.ingress.kubernetes.io/force-ssl-redirect,
    which holds even for a host no ingress.tls entry names, served by the controller's default
    certificate or a load balancer that terminates TLS; F5 NGINX redirects a TLS host by default).
  - HSTS (C255.1) from ingress.hsts: openverify.dev/strict-transport-security records the header's
    value for any controller, and F5 NGINX reads nginx.org/hsts, -max-age and -include-subdomains; the
    community ingress-nginx controller sends HSTS from its own ConfigMap, whose default is the same
    one year with subdomains. Another controller needs its own setting (the self-hosting guide).
  - The body limit (nginx.ingress.kubernetes.io/proxy-body-size and nginx.org/client-max-body-size):
    ingress.maxBodySize (default 15m: PATCH /api/v1/cases/:id takes a base64 attachment up to 14 MiB,
    the uploads 10 MiB plus multipart overhead), maxBodySizeImport (28m: the list importer's
    26,670,764 bytes) or maxBodySizeTransactionFile (28m: a transaction file of up to 20,000,000
    bytes plus multipart overhead). The API keeps its own per-route limits behind these.
  - ingress.annotations last, so the operator's own keys win.
*/ -}}
{{- define "openverify.ingressAnnotations" -}}
{{- $v := .root.Values.ingress -}}
{{- $limit := index (dict "default" $v.maxBodySize "import" $v.maxBodySizeImport "transactionFile" $v.maxBodySizeTransactionFile) .path -}}
{{- $a := dict
  "nginx.ingress.kubernetes.io/force-ssl-redirect" "true"
  "nginx.ingress.kubernetes.io/proxy-body-size" $limit
  "nginx.org/client-max-body-size" $limit -}}
{{- if $v.hsts.enabled -}}
{{- $_ := set $a "openverify.dev/strict-transport-security" (printf "max-age=%d%s%s" (int $v.hsts.maxAge) (ternary "; includeSubDomains" "" $v.hsts.includeSubDomains) (ternary "; preload" "" $v.hsts.preload)) -}}
{{- $_ := set $a "nginx.org/hsts" "true" -}}
{{- $_ := set $a "nginx.org/hsts-max-age" (toString (int $v.hsts.maxAge)) -}}
{{- $_ := set $a "nginx.org/hsts-include-subdomains" (toString $v.hsts.includeSubDomains) -}}
{{- end -}}
{{- range $key, $value := ($v.annotations | default dict) -}}
{{- $_ := set $a $key (toString $value) -}}
{{- end -}}
{{- toYaml $a -}}
{{- end -}}

{{- /*
openverify.internalPathDeny (dict "root" $): the API host's first path, /api/v1/internal (Prefix, so
/api/v1/internal/ and everything under it), sent to <fullname>-api-internal-deny, a Service this chart
never creates: no endpoint exists behind it, so the controller refuses the request (C250.3, C264.5).
A controller that drops a rule with a missing backend falls back to /, the API's public listener,
which answers its generic 404 there; no Ingress ever routes the internal listener's port.
*/ -}}
{{- define "openverify.internalPathDeny" -}}
- path: /api/v1/internal
  pathType: Prefix
  backend:
    service:
      name: {{ include "openverify.componentName" (dict "root" .root "component" "api-internal-deny") }}
      port:
        name: deny
{{- end -}}
