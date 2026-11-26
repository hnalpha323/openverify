{{- /*
C263.2 (Workflow 11C Stage 2, chart-11c): each process's non-secret configuration, placed by the
configuration registry's `processes` field (apps/api/src/config-registry.ts, orchestrator decision
17). openverify.configData (dict "root" $ "process" <api|worker|migrate|dashboard|flow|vision|codeRunner>)
answers the variables as YAML; templates/configmap.yaml writes the long-running processes' ConfigMaps
and templates/migrate-job.yaml inlines migrate's (a pre-install hook runs before the release's
ConfigMaps exist). No secret is here: every secret is a file from the process's own Secret (C264.3).

Left out on purpose: OPENVERIFY_SANDBOX_CHIP_FACES (no image or chart holds a face), a deviceIntegrity
binding (no device is asked for a token unless `providers` binds one),
OPENVERIFY_DASHBOARD_INSECURE_COOKIES, and any static frame-ancestors (the flow server reads each
inquiry's embed policy per request, C263.2).
*/ -}}
{{- define "openverify.configData" -}}
{{- $root := .root -}}
{{- $v := $root.Values -}}
{{- $p := .process -}}
{{- $d := dict -}}
{{- $apiUrl := include "openverify.publicUrl" (dict "root" $root "host" "api") -}}
{{- $flowUrl := include "openverify.publicUrl" (dict "root" $root "host" "flow") -}}
{{- $consoleUrl := include "openverify.publicUrl" (dict "root" $root "host" "dashboard") -}}
{{- if has $p (list "api" "worker" "migrate" "dashboard" "flow") -}}
{{- $_ := set $d "OPENVERIFY_MODE" $v.install.mode -}}
{{- end -}}
{{- if has $p (list "api" "worker") -}}
{{- $_ := set $d "OPENVERIFY_LOG_LEVEL" (toString $v.install.logLevel) -}}
{{- $_ := set $d "OPENVERIFY_CONNECT_ENABLED" (toString $v.install.connectEnabled) -}}
{{- $_ := set $d "OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED" (toString $v.install.watchlistUnOptInAllowed) -}}
{{- $_ := set $d "OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX" (toString $v.install.queueInFlightCapMax) -}}
{{- $_ := set $d "OPENVERIFY_HANDOFF_SENDS_PER_HOUR" (toString $v.api.handoffSendsPerHour) -}}
{{- $_ := set $d "OPENVERIFY_VISION_URL" (include "openverify.serviceUrl" (dict "root" $root "component" "vision" "port" $v.vision.port)) -}}
{{- $_ := set $d "S3_FORCE_PATH_STYLE" (toString $v.external.s3.forcePathStyle) -}}
{{- with $v.external.s3.endpoint }}{{ $_ := set $d "S3_ENDPOINT" . }}{{ end -}}
{{- with $v.external.s3.region }}{{ $_ := set $d "S3_REGION" . }}{{ end -}}
{{- with $v.external.s3.bucket }}{{ $_ := set $d "S3_BUCKET" . }}{{ end -}}
{{- with $v.external.smtp.mailFrom }}{{ $_ := set $d "OPENVERIFY_MAIL_FROM" . }}{{ end -}}
{{- with $flowUrl }}{{ $_ := set $d "OPENVERIFY_FLOW_PUBLIC_URL" . }}{{ end -}}
{{- with $consoleUrl }}{{ $_ := set $d "OPENVERIFY_DASHBOARD_PUBLIC_URL" . }}{{ end -}}
{{- with $v.api.trustProxy }}{{ $_ := set $d "OPENVERIFY_TRUST_PROXY" (toString .) }}{{ end -}}
{{- with $v.network.sourcesDisabled }}{{ $_ := set $d "OPENVERIFY_NETWORK_SOURCES_DISABLED" . }}{{ end -}}
{{- with $v.network.sourcesEnabled }}{{ $_ := set $d "OPENVERIFY_NETWORK_SOURCES_ENABLED" . }}{{ end -}}
{{- with $v.ipReputation.path }}{{ $_ := set $d "OPENVERIFY_IP_REPUTATION_MMDB_PATH" . }}{{ end -}}
{{- if $v.codeRunner.enabled }}{{ $_ := set $d "OPENVERIFY_WORKFLOW_CODE_RUNNER" (printf "tcp:%s:%v" (include "openverify.componentName" (dict "root" $root "component" "code-runner")) $v.codeRunner.port) }}{{ end -}}
{{- range $name, $value := $v.providers }}{{ $_ := set $d $name (toString $value) }}{{ end -}}
{{- end -}}
{{- if eq $p "api" -}}
{{- $_ := set $d "OPENVERIFY_API_HOST" "0.0.0.0" -}}
{{- $_ := set $d "OPENVERIFY_API_PORT" (toString $v.api.port) -}}
{{- $_ := set $d "OPENVERIFY_INTERNAL_LISTEN" (printf "0.0.0.0:%v" $v.api.internalListen.port) -}}
{{- $_ := set $d "OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS" (toString $v.api.console.idleTimeoutSeconds) -}}
{{- $_ := set $d "OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS" (toString $v.api.console.absoluteTimeoutSeconds) -}}
{{- with $v.api.ssoPrivateIssuers }}{{ $_ := set $d "OPENVERIFY_SSO_PRIVATE_ISSUERS" (join "," .) }}{{ end -}}
{{- end -}}
{{- if eq $p "worker" -}}
{{- $_ := set $d "OPENVERIFY_WORKER_CONCURRENCY" (toString $v.worker.concurrency) -}}
{{- $_ := set $d "OPENVERIFY_WORKER_HEARTBEAT_FILE" $v.worker.heartbeatFile -}}
{{- $_ := set $d "OPENVERIFY_NETWORK_REFRESH" (toString $v.network.refresh) -}}
{{- with $v.worker.playIntegrity.packageName }}{{ $_ := set $d "OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME" . }}{{ end -}}
{{- if $v.worker.extraContainers }}{{ $_ := set $d "OPENVERIFY_CLAMD_SOCKET" "/run/clamd/clamd.sock" }}{{ end -}}
{{- with $v.worker.playIntegrity.certificateDigests }}{{ $_ := set $d "OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS" . }}{{ end -}}
{{- end -}}
{{- if eq $p "codeRunner" -}}
{{- $_ := set $d "OPENVERIFY_CODE_RUNNER_LISTEN" (printf "0.0.0.0:%v" $v.codeRunner.port) -}}
{{- if gt (int $v.codeRunner.poolSize) 0 }}{{ $_ := set $d "OPENVERIFY_CODE_RUNNER_POOL_SIZE" (toString $v.codeRunner.poolSize) }}{{ end -}}
{{- end -}}
{{- if eq $p "vision" -}}
{{- $_ := set $d "OPENVERIFY_VISION_MODELS_DIR" (printf "/models/%s" (include "openverify.modelsDigest" $root)) -}}
{{- end -}}
{{- if eq $p "migrate" -}}
{{- $_ := set $d "OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS" (toString $v.migrate.lockTimeoutSeconds) -}}
{{- end -}}
{{- if has $p (list "api" "worker" "migrate") -}}
{{- range $name, $value := $v.config.extra }}{{ $_ := set $d $name (toString $value) }}{{ end -}}
{{- end -}}
{{- if has $p (list "api" "flow" "dashboard") -}}
{{- $_ := set $d "OPENVERIFY_HSTS_MAX_AGE" (toString $v.install.hstsMaxAge) -}}
{{- end -}}
{{- if eq $p "dashboard" -}}
{{- $_ := set $d "OPENVERIFY_API_URL" (include "openverify.serviceUrl" (dict "root" $root "component" "api" "port" $v.api.port)) -}}
{{- $_ := set $d "OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS" (toString $v.dashboard.trustedProxyHops) -}}
{{- $_ := set $d "OPENVERIFY_DASHBOARD_CSP_MODE" "enforce" -}}
{{- with $flowUrl }}{{ $_ := set $d "OPENVERIFY_FLOW_PUBLIC_URL" . }}{{ end -}}
{{- end -}}
{{- if eq $p "flow" -}}
{{- with $apiUrl }}{{ $_ := set $d "OPENVERIFY_FLOW_API_URL" . }}{{ end -}}
{{- $_ := set $d "OPENVERIFY_FLOW_SERVER_API_URL" (include "openverify.serviceUrl" (dict "root" $root "component" "api-internal" "port" $v.api.internalListen.port)) -}}
{{- $_ := set $d "OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS" (toString $v.flow.trustedProxyHops) -}}
{{- with $consoleUrl }}{{ $_ := set $d "OPENVERIFY_DASHBOARD_PUBLIC_URL" . }}{{ end -}}
{{- end -}}
{{- toYaml $d -}}
{{- end -}}

{{- /* openverify.configChecksum (dict "root" $ "process" <name>): rolls a Deployment when its configuration changes. */ -}}
{{- define "openverify.configChecksum" -}}
{{- include "openverify.configData" . | sha256sum -}}
{{- end -}}

{{- /* openverify.envList (YAML map): the map as a container env list, by name. */ -}}
{{- define "openverify.envList" -}}
{{- $map := fromYaml . -}}
{{- range $name := keys $map | sortAlpha }}
- name: {{ $name }}
  value: {{ index $map $name | toString | quote }}
{{- end }}
{{- end -}}
