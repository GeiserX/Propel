{{/*
Expand the name of the chart.
*/}}
{{- define "pumperly.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "pumperly.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "pumperly.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "pumperly.labels" -}}
helm.sh/chart: {{ include "pumperly.chart" . }}
{{ include "pumperly.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "pumperly.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pumperly.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
PostGIS selector labels
*/}}
{{- define "pumperly.postgis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pumperly.name" . }}-postgis
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Valhalla selector labels
*/}}
{{- define "pumperly.valhalla.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pumperly.name" . }}-valhalla
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Photon selector labels
*/}}
{{- define "pumperly.photon.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pumperly.name" . }}-photon
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "pumperly.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "pumperly.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostGIS fully qualified name
*/}}
{{- define "pumperly.postgis.fullname" -}}
{{- printf "%s-postgis" (include "pumperly.fullname" .) }}
{{- end }}

{{/*
Valhalla fully qualified name
*/}}
{{- define "pumperly.valhalla.fullname" -}}
{{- printf "%s-valhalla" (include "pumperly.fullname" .) }}
{{- end }}

{{/*
Photon fully qualified name
*/}}
{{- define "pumperly.photon.fullname" -}}
{{- printf "%s-photon" (include "pumperly.fullname" .) }}
{{- end }}

{{/*
Secret name
*/}}
{{- define "pumperly.secretName" -}}
{{- printf "%s-secret" (include "pumperly.fullname" .) }}
{{- end }}

{{/*
Construct DATABASE_URL from postgis auth values
*/}}
{{- define "pumperly.databaseUrl" -}}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgis.auth.username .Values.postgis.auth.password (include "pumperly.postgis.fullname" .) .Values.postgis.auth.database }}
{{- end }}
