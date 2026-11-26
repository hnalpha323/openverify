{{- /*
C263 (Workflow 11C Stage 2, chart-11c): the Deployment and Service every component renders through,
so each one carries the same labels, the restricted security helpers (_security.tpl), its own
ConfigMap and its own Secret as files.

openverify.deployment takes a dict:
  root       the chart's top context ($)
  component  the component's name (api, worker, vision, flow, dashboard, code-runner)
  process    its Secret and CA process (api, worker, vision, flow, dashboard, codeRunner)
  c          its values (.Values.<component>)
  command    the container's command, a list (optional; the image's own otherwise)
  ports      the container's ports as YAML (optional)
  probes     the probes as YAML (optional)
  mounts     extra volumeMounts as YAML (optional)
  volumes    extra volumes as YAML (optional)
  sidecars   extra containers as YAML (optional)
  hpa        true when an HPA may own the replica count
*/ -}}
{{- define "openverify.deployment" -}}
{{- $root := .root -}}
{{- $c := .c -}}
{{- $name := include "openverify.componentName" (dict "root" $root "component" .component) -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $name }}
  labels:
    {{- include "openverify.labels" (dict "root" $root "component" .component) | nindent 4 }}
spec:
  {{- if not (and .hpa $c.autoscaling.enabled) }}
  replicas: {{ $c.replicaCount }}
  {{- end }}
  revisionHistoryLimit: 3
  selector:
    matchLabels:
      {{- include "openverify.selectorLabels" (dict "root" $root "component" .component) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "openverify.labels" (dict "root" $root "component" .component) | nindent 8 }}
      annotations:
        checksum/config: {{ include "openverify.configChecksum" (dict "root" $root "process" .process) }}
    spec:
      {{- include "openverify.podSpecCommon" (dict "root" $root "c" $c) | nindent 6 }}
      containers:
        - name: {{ .component }}
          image: {{ include "openverify.image" (dict "root" $root "image" $c.image) | quote }}
          imagePullPolicy: {{ $c.image.pullPolicy | default "IfNotPresent" }}
          {{- with .command }}
          command:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .ports }}
          ports:
            {{- . | nindent 12 }}
          {{- end }}
          envFrom:
            - configMapRef:
                name: {{ $name }}
          {{- with (include "openverify.containerEnv" (dict "root" $root "process" .process "c" $c) | trim) }}
          env:
            {{- . | nindent 12 }}
          {{- end }}
          securityContext:
            {{- include "openverify.containerSecurityContext" (dict "root" $root) | nindent 12 }}
          {{- with $c.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with (.probes | default "" | trim) }}
          {{- . | nindent 10 }}
          {{- end }}
          volumeMounts:
            {{- include "openverify.volumeMounts" (dict "root" $root "process" .process) | nindent 12 }}
            {{- with .mounts }}
            {{- . | nindent 12 }}
            {{- end }}
        {{- with .sidecars }}
        {{- . | nindent 8 }}
        {{- end }}
      volumes:
        {{- include "openverify.volumes" (dict "root" $root "process" .process) | nindent 8 }}
        {{- with .volumes }}
        {{- . | nindent 8 }}
        {{- end }}
{{- end -}}

{{- /*
openverify.service (dict "root" $ "component" <name> "name" <service name> "ports" <YAML>): a
ClusterIP Service selecting the component's pods.
*/ -}}
{{- define "openverify.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels:
    {{- include "openverify.labels" (dict "root" .root "component" .component) | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "openverify.selectorLabels" (dict "root" .root "component" .component) | nindent 4 }}
  ports:
    {{- .ports | nindent 4 }}
{{- end -}}
