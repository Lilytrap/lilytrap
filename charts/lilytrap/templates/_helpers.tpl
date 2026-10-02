{{- define "lilytrap.namespaces" -}}
{{- if .Values.namespaces }}{{ join "," .Values.namespaces }}{{ else }}{{ .Release.Namespace }}{{ end -}}
{{- end -}}

{{- define "lilytrap.trapHost" -}}
{{- regexReplaceAll "^https?://([^/]+).*$" .Values.lilytrap.trapUrl "${1}" -}}
{{- end -}}

{{/*
Decoy values, stable across upgrades: pinned tokens.* first, then what's already in the cluster
(same rotation), then fresh random values. Rendered once into a dict so every template agrees.
*/}}
{{- define "lilytrap.decoys" -}}
{{- $root := . -}}
{{- $out := dict -}}
{{- range $ns := splitList "," (include "lilytrap.namespaces" $root) -}}
{{- $admin := printf "%s-platform-admin" $root.Values.namePrefix -}}
{{- $reg := printf "%s-registry-push" $root.Values.namePrefix -}}
{{- $existing := lookup "v1" "Secret" $ns $admin -}}
{{- $existingReg := lookup "v1" "Secret" $ns $reg -}}
{{- $sameRotation := and $existing (eq (index ($existing.metadata.annotations | default dict) "platform.ops/rotation" | default "") (toString $root.Values.rotate)) -}}
{{- $token := $root.Values.tokens.adminToken -}}
{{- if not $token -}}{{- if $sameRotation -}}{{- $token = index $existing.data "admin_token" | b64dec -}}{{- else -}}{{- $token = printf "adm_%s" (randAlphaNum 40) -}}{{- end -}}{{- end -}}
{{- $path := "" -}}
{{- if $sameRotation -}}{{- $path = index $existing.metadata.annotations "platform.ops/admin-path" -}}{{- else -}}{{- $path = printf "/internal/platform-admin/%s/v1" (randAlphaNum 8 | lower) -}}{{- end -}}
{{- $pass := $root.Values.tokens.registryPassword -}}
{{- if not $pass -}}
{{- if and $sameRotation $existingReg -}}
{{- $cfg := index $existingReg.data ".dockerconfigjson" | b64dec | fromJson -}}
{{- range $h, $a := $cfg.auths -}}{{- $pass = $a.password -}}{{- end -}}
{{- end -}}
{{- if not $pass -}}{{- $pass = randAlphaNum 40 -}}{{- end -}}
{{- end -}}
{{- $_ := set $out $ns (dict "adminName" $admin "registryName" $reg "token" $token "path" $path "password" $pass) -}}
{{- end -}}
{{- toJson $out -}}
{{- end -}}

{{/* Render the decoys once per release render; every template must see the same random values. */}}
{{- define "lilytrap.decoysOnce" -}}
{{- if not (hasKey .Values "_lilytrapDecoys") -}}
{{- $_ := set .Values "_lilytrapDecoys" (include "lilytrap.decoys" .) -}}
{{- end -}}
{{- .Values._lilytrapDecoys -}}
{{- end -}}
