{{- /*
C263 (Workflow 11C Stage 2, chart-11c): names, labels, image references, the public URLs, the
per-process environment and the relational checks every template shares. The security helpers
(the restricted contexts, /tmp, the Secrets as files, the CA files, the ingress annotations and the
internal-path deny) are chart-policy-11c's, in _security.tpl.
*/ -}}

{{- /* The chart's name, or nameOverride. */ -}}
{{- define "openverify.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- /* The release's base name: fullnameOverride, or <release>-<chart> unless the release already holds it. */ -}}
{{- define "openverify.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- /* chart-version, for the helm.sh/chart label. */ -}}
{{- define "openverify.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- /*
openverify.componentName (dict "root" $ "component" <name>): <fullname>-<component>, the name of
the component's Deployment, Service, ConfigMap, HPA and PDB. Components: api, worker, vision, flow,
dashboard, code-runner, migrate, models-fetch.
*/ -}}
{{- define "openverify.componentName" -}}
{{- printf "%s-%s" (include "openverify.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- /*
openverify.selectorLabels (dict "root" $ "component" <name>): the labels a Service, a PDB and every
network policy select a component's pods by: app.kubernetes.io/name, /instance and /component.
*/ -}}
{{- define "openverify.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openverify.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- /* openverify.labels (dict "root" $ "component" <name>): the selector labels and the chart's. */ -}}
{{- define "openverify.labels" -}}
{{ include "openverify.selectorLabels" . }}
app.kubernetes.io/part-of: openverify
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ include "openverify.chart" .root }}
{{- end -}}

{{- /*
openverify.image (dict "root" $ "image" <component>.image): [<registry>/]<repository>:<tag>[@<digest>].
The tag defaults to the chart's appVersion; a digest, when given, is appended so the runtime pulls
by digest (C258.1: tag@sha256:...).
*/ -}}
{{- define "openverify.image" -}}
{{- $repository := .image.repository -}}
{{- if .image.registry -}}
{{- $repository = printf "%s/%s" (trimSuffix "/" .image.registry) .image.repository -}}
{{- end -}}
{{- $tag := default .root.Chart.AppVersion .image.tag -}}
{{- if .image.digest -}}
{{- printf "%s:%s@%s" $repository $tag .image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end -}}

{{- /*
openverify.publicUrl (dict "root" $ "host" <api|flow|dashboard>): publicUrls.<host>, or
https://<ingress.hosts.<host>> when only the ingress host is given, or empty.
*/ -}}
{{- define "openverify.publicUrl" -}}
{{- $url := index .root.Values.publicUrls .host -}}
{{- $ingressHost := index .root.Values.ingress.hosts .host -}}
{{- if $url -}}
{{- trimSuffix "/" $url -}}
{{- else if $ingressHost -}}
{{- printf "https://%s" $ingressHost -}}
{{- end -}}
{{- end -}}

{{- /*
openverify.serviceUrl (dict "root" $ "component" <name> "port" <port>): the in-cluster URL of a
component's Service, http://<fullname>-<component>:<port>.
*/ -}}
{{- define "openverify.serviceUrl" -}}
{{- printf "http://%s:%v" (include "openverify.componentName" (dict "root" .root "component" .component)) .port -}}
{{- end -}}

{{- /*
openverify.checks: the relational rules values.schema.json cannot hold (C263.3), each a
`fail` with its message; every component template includes it so `helm template` of any one fails.
*/ -}}
{{- define "openverify.checks" -}}
{{- $v := .Values -}}
{{- if le (int $v.migrate.activeDeadlineSeconds) (int $v.migrate.lockTimeoutSeconds) -}}
{{- fail (printf "migrate.activeDeadlineSeconds (%v) must exceed migrate.lockTimeoutSeconds (%v): a Job past its deadline is killed before the migrate lock's wait ends (C263.3)" $v.migrate.activeDeadlineSeconds $v.migrate.lockTimeoutSeconds) -}}
{{- end -}}
{{- if not (hasPrefix "/tmp/" $v.worker.heartbeatFile) -}}
{{- fail "worker.heartbeatFile must be under /tmp/, the worker's only writable path (C250.2, C257.1)" -}}
{{- end -}}
{{- if eq $v.install.mode "production" -}}
{{- $console := include "openverify.publicUrl" (dict "root" . "host" "dashboard") -}}
{{- if $console -}}
{{- $host := (urlParse $console).hostname -}}
{{- if or (eq $host "localhost") (hasPrefix "127." $host) (eq $host "::1") (eq $host "[::1]") (hasSuffix ".localhost" $host) -}}
{{- fail "publicUrls.dashboard (OPENVERIFY_DASHBOARD_PUBLIC_URL) is a loopback address; in production it is the console's public URL, which graph results and links carry (Workflow 7B)" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if has "OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON" $v.secrets.api.keys -}}
{{- fail "OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON belongs in the worker's Secret only (secrets.worker.keys), never the API's (C211.4)" -}}
{{- end -}}
{{- if hasKey $v.config.extra "OPENVERIFY_SANDBOX_CHIP_FACES" -}}
{{- fail "OPENVERIFY_SANDBOX_CHIP_FACES is never set by the chart: no image or chart holds a face (Phase 10 C208)" -}}
{{- end -}}
{{- $ipDir := "/var/lib/openverify/ip-reputation/" -}}
{{- if and $v.ipReputation.existingClaim (not (hasPrefix $ipDir (default "" $v.ipReputation.path))) -}}
{{- fail (printf "ipReputation.path must name the MMDB under %s, where ipReputation.existingClaim is mounted read-only (OPENVERIFY_IP_REPUTATION_MMDB_PATH, Workflow 7A)" $ipDir) -}}
{{- end -}}
{{- if and $v.ipReputation.path (not $v.ipReputation.existingClaim) -}}
{{- fail "ipReputation.path needs ipReputation.existingClaim: the chart ships no MMDB, and the file is read from the operator's claim (ADR 0006)" -}}
{{- end -}}
{{- include "openverify.poolCheck" . -}}
{{- if and $v.codeRunner.enabled (not (and (has "OPENVERIFY_CODE_RUNNER_TOKEN" $v.secrets.worker.keys) (has "OPENVERIFY_CODE_RUNNER_TOKEN" $v.secrets.codeRunner.keys))) -}}
{{- fail "OPENVERIFY_CODE_RUNNER_TOKEN must be in secrets.worker.keys and secrets.codeRunner.keys while codeRunner.enabled: the worker reaches the runner over tcp: with the token both hold (C263.6)" -}}
{{- end -}}
{{- if and (eq $v.models.source "pvc") (not $v.models.existingClaim) -}}
{{- fail "models.source pvc needs models.existingClaim: the claim the operator filled once with python3 -I scripts/fetch_models.py --dest <claim>/<manifest digest> (C263.5)" -}}
{{- end -}}
{{- if and (eq $v.models.source "job") (eq $v.models.accessMode "ReadOnlyMany") -}}
{{- fail "models.accessMode ReadOnlyMany fits only models.source pvc: in job mode the models-fetch Job writes the claim (use ReadWriteMany for more than one vision replica)" -}}
{{- end -}}
{{- range $component := list "api" "worker" "dashboard" "flow" "vision" "codeRunner" -}}
{{- range (index $v $component).extraEnv -}}
{{- if eq .name "OPENVERIFY_SANDBOX_CHIP_FACES" -}}
{{- fail (printf "%s.extraEnv sets OPENVERIFY_SANDBOX_CHIP_FACES, which the chart never sets: no image or chart holds a face (Phase 10 C208)" $component) -}}
{{- end -}}
{{- if and (eq .name "OPENVERIFY_DASHBOARD_INSECURE_COOKIES") (eq (lower .value) "true") -}}
{{- fail (printf "%s.extraEnv sets OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true; the console's session cookie stays Secure behind the ingress's TLS (C21)" $component) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- /*
openverify.poolCheck: C263.4's pool check. The API (apps/api/src/container.ts) and the worker
(apps/api/src/worker.ts) each open one node-postgres pool with no `max`, so pg-pool's default of 10
connections; db:migrate opens a pool and its lock client (apps/api/src/migrate.ts), 11. Each
Deployment counts at its most pods: replicaCount, or the HPA's maxReplicas for the API (the worker
has no HPA), plus a rolling update's default surge of 25% rounded up, because an upgrade runs the old
pods, the surge and the migrate Job at once.
*/ -}}
{{- define "openverify.pooledPods" -}}
{{- $n := int .replicaCount -}}
{{- if and .hpa .c.autoscaling.enabled -}}
{{- $n = int .c.autoscaling.maxReplicas -}}
{{- end -}}
{{- add $n (div (add $n 3) 4) -}}
{{- end -}}
{{- define "openverify.poolCheck" -}}
{{- $v := .Values -}}
{{- $pool := 10 -}}
{{- $migrate := 11 -}}
{{- $api := int (include "openverify.pooledPods" (dict "c" $v.api "replicaCount" $v.api.replicaCount "hpa" true)) -}}
{{- $worker := int (include "openverify.pooledPods" (dict "c" $v.worker "replicaCount" $v.worker.replicaCount "hpa" false)) -}}
{{- $total := add (mul $api $pool) (mul $worker $pool) $migrate -}}
{{- if gt $total (int $v.external.postgres.maxConnections) -}}
{{- fail (printf "the database pools could open %d connections (api %d pods x %d, worker %d pods x %d, migrate %d), above external.postgres.maxConnections (%d): raise it, or lower the replicas (C263.4)" $total $api $pool $worker $pool $migrate (int $v.external.postgres.maxConnections)) -}}
{{- end -}}
{{- end -}}

{{- /*
openverify.restrictedContainers (dict "root" $ "containers" <list>): the operator's extra containers
(worker.extraContainers: its clamd), each under the restricted container context of _security.tpl,
which wins over the container's own for the keys it sets (OD-11C-5).
*/ -}}
{{- define "openverify.restrictedContainers" -}}
{{- $restricted := fromYaml (include "openverify.containerSecurityContext" (dict "root" .root)) -}}
{{- $out := list -}}
{{- range .containers -}}
{{- $container := deepCopy . -}}
{{- $own := deepCopy (default (dict) $container.securityContext) -}}
{{- $_ := set $container "securityContext" (mergeOverwrite $own (deepCopy $restricted)) -}}
{{- $out = append $out $container -}}
{{- end -}}
{{- toYaml $out -}}
{{- end -}}

{{- /*
openverify.httpProbes (dict "path" <path> "startupFailures" <n>): readiness and liveness (and, with
startupFailures, a startup probe every 5 s) as HTTP GETs of `path` on the container's `http` port.
*/ -}}
{{- define "openverify.httpProbes" -}}
readinessProbe:
  httpGet:
    path: {{ default .path .readyPath }}
    port: http
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
livenessProbe:
  httpGet:
    path: {{ .path }}
    port: http
  periodSeconds: 20
  timeoutSeconds: 5
  failureThreshold: 3
{{- with .startupFailures }}
startupProbe:
  httpGet:
    path: {{ $.path }}
    port: http
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: {{ . }}
{{- end }}
{{- end -}}

{{- /*
openverify.execProbes (dict "command" <list> "ready" <bool> "startupFailures" <n>): liveness (and
readiness with ready, and a startup probe every 10 s with startupFailures) running `command` with
no shell.
*/ -}}
{{- define "openverify.execProbes" -}}
{{- if .ready }}
readinessProbe:
  exec:
    command:
      {{- toYaml .command | nindent 6 }}
  periodSeconds: 15
  timeoutSeconds: 6
  failureThreshold: 3
{{- end }}
livenessProbe:
  exec:
    command:
      {{- toYaml .command | nindent 6 }}
  periodSeconds: 15
  timeoutSeconds: 6
  failureThreshold: 3
{{- with .startupFailures }}
startupProbe:
  exec:
    command:
      {{- toYaml $.command | nindent 6 }}
  periodSeconds: 10
  timeoutSeconds: 6
  failureThreshold: {{ . }}
{{- end }}
{{- end -}}

{{- /*
openverify.ipReputationVolume and openverify.ipReputationMount (dict "root" $): the operator's
anonymous-IP MMDB claim (ipReputation.existingClaim), read-only at /var/lib/openverify/ip-reputation
in the API's and the worker's pods only (Workflow 7A); nothing without the claim.
*/ -}}
{{- define "openverify.ipReputationVolume" -}}
{{- with .root.Values.ipReputation.existingClaim }}
- name: ip-reputation
  persistentVolumeClaim:
    claimName: {{ . }}
    readOnly: true
{{- end }}
{{- end -}}
{{- define "openverify.ipReputationMount" -}}
{{- if .root.Values.ipReputation.existingClaim }}
- name: ip-reputation
  mountPath: /var/lib/openverify/ip-reputation
  readOnly: true
{{- end }}
{{- end -}}

{{- /*
openverify.modelsDigest: the SHA-256 of models/manifest.json, from the chart's byte copy
files/models-manifest.json (a chart renders only its own files). Vision reads
/models/<digest> (OPENVERIFY_VISION_MODELS_DIR), and the models-fetch Job fills that directory,
refusing an image whose manifest has another digest (C263.5).
*/ -}}
{{- define "openverify.modelsDigest" -}}
{{- $manifest := .Files.Get "files/models-manifest.json" -}}
{{- if not $manifest -}}
{{- fail "files/models-manifest.json is missing from the chart: it is the byte copy of models/manifest.json whose SHA-256 names the models directory (C263.5)" -}}
{{- end -}}
{{- $manifest | sha256sum -}}
{{- end -}}

{{- /* openverify.modelsClaim: models.existingClaim, or the chart's own claim <fullname>-models (job mode). */ -}}
{{- define "openverify.modelsClaim" -}}
{{- default (include "openverify.componentName" (dict "root" . "component" "models")) .Values.models.existingClaim -}}
{{- end -}}

{{- /*
openverify.podSpecCommon (dict "root" $ "c" <component values>): the pod fields every component
shares: no service-account token (C264.1), no Service environment variables (whose names, such as
OPENVERIFY_API_PORT for a release named openverify, would collide with the configuration's), the
pull secrets, the pod's restricted security context (uid and gid 10001, Stage 1a amendment 30),
the scheduling values and the grace period.
*/ -}}
{{- define "openverify.podSpecCommon" -}}
automountServiceAccountToken: false
enableServiceLinks: false
{{- with .root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
securityContext:
  {{- include "openverify.podSecurityContext" (dict "root" .root "uid" 10001 "gid" 10001) | nindent 2 }}
{{- with .c.priorityClassName }}
priorityClassName: {{ . }}
{{- end }}
{{- with .c.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .c.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .c.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .c.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- if hasKey .c "terminationGracePeriodSeconds" }}
terminationGracePeriodSeconds: {{ .c.terminationGracePeriodSeconds }}
{{- end }}
{{- end -}}

{{- /*
openverify.containerEnv (dict "root" $ "process" <name> "c" <component values>): the container's env
list: each Secret key as <NAME>_FILE (openverify.secretFileEnv), each CA file
(openverify.caFileEnv), then the component's extraEnv. Empty when there is none.
*/ -}}
{{- define "openverify.containerEnv" -}}
{{- $secret := include "openverify.secretFileEnv" (dict "root" .root "process" .process) | trim -}}
{{- $ca := include "openverify.caFileEnv" (dict "root" .root "process" .process) | trim -}}
{{- with $secret }}
{{ . }}
{{- end }}
{{- with $ca }}
{{ . }}
{{- end }}
{{- with .c.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- /*
openverify.volumes (dict "root" $ "process" <name>) and openverify.volumeMounts (same): /tmp, the
process's Secret and its CA files.
*/ -}}
{{- define "openverify.volumes" -}}
{{- include "openverify.tmpVolume" (dict "root" .root) }}
{{- with (include "openverify.secretVolume" (dict "root" .root "process" .process) | trim) }}
{{ . }}
{{- end }}
{{- with (include "openverify.caVolumes" (dict "root" .root "process" .process) | trim) }}
{{ . }}
{{- end }}
{{- end -}}
{{- define "openverify.volumeMounts" -}}
{{- include "openverify.tmpVolumeMount" (dict "root" .root) }}
{{- with (include "openverify.secretVolumeMounts" (dict "root" .root "process" .process) | trim) }}
{{ . }}
{{- end }}
{{- with (include "openverify.caVolumeMounts" (dict "root" .root "process" .process) | trim) }}
{{ . }}
{{- end }}
{{- end -}}
