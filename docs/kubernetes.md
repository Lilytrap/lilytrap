# Kubernetes

The Helm chart plants decoy Secrets in the namespaces you choose. The Secrets look like a platform admin token and registry push credentials. They never mention Lilytrap. Using one hits the trap.

Rules for agents:

- Add the install to the repository's Helm, Argo CD or Flux config in a pull request. A human applies it.
- Keep the API key in a Kubernetes Secret. Never put it in values files.

## Install

1. Create a Secret with the workspace API key, in the namespace the release goes in:

```bash
kubectl create namespace platform-system
kubectl -n platform-system create secret generic lilytrap-api-key --from-literal=LILYTRAP_API_KEY=<key>
```

2. Install the chart from the public repository:

```bash
git clone --depth 1 --branch v0 https://github.com/lilytrap/lilytrap /tmp/lilytrap
helm upgrade --install decoys /tmp/lilytrap/charts/lilytrap -n platform-system \
  --set lilytrap.existingSecret=lilytrap-api-key \
  --set 'namespaces={payments,web}'
```

Pick the namespaces an attacker would want: payments, customer data, production web. With no `namespaces`, the decoys go in the release namespace.

## What happens on install and upgrade

| Step | Hook | What it does |
|---|---|---|
| 1 | pre-install, pre-upgrade | The policy-check Job checks each decoy Secret against the ignore rules. If one is ignored, the release stops before anything is created. |
| 2 | install | Creates the decoy Secrets. |
| 3 | post-install, post-upgrade | The registration Job sends the decoys' hashes to Lilytrap. |
| 4 | pre-delete | `helm uninstall` retires the deployment. Its decoys stop matching. |

## When the policy check fails

Each decoy Secret's path is `k8s/<namespace>/secrets/<name>`. The workspace's ignore rules and the chart's `ignore` value both apply. Find which decoy was ignored:

```bash
kubectl logs job/decoys-lilytrap-policy-check -n platform-system
```

Then do one of these:

- Turn that decoy off: `--set decoys.adminToken.enabled=false` or `--set decoys.registry.enabled=false`.
- Rename it: `--set decoys.adminToken.name=<new name>`.
- Remove the namespace from `namespaces`.

## Rotate

Change `rotate` to plant fresh values. Do this after an incident, because the old values are burned.

```bash
helm upgrade decoys /tmp/lilytrap/charts/lilytrap -n platform-system --reuse-values --set rotate=$(date +%s)
```

Argo CD and other tools that render without cluster access can't read the current values back. Pin them with `tokens.adminToken` and `tokens.registryPassword` from a secret manager instead.

## Values

<!-- gen:helm-values -->
| Value | Default | Description |
|---|---|---|
| `lilytrap.apiKey` | `""` | Workspace API key (wsk_...). Used only by the registration Job to send the decoys' hashes. |
| `lilytrap.existingSecret` | `""` | Or an existing Secret in the release namespace with the key under LILYTRAP_API_KEY. |
| `lilytrap.apiUrl` | `https://api.lilytrap.com` |  |
| `lilytrap.trapUrl` | `https://d3bjf2fihdw81m.cloudfront.net` | Trap the decoys point at (GET https://api.lilytrap.com/agent/v1/config returns it). |
| `namePrefix` | `prod` | Makes the decoys look like they belong: prod-platform-admin, prod-registry-push. |
| `namespaces` | `[]` | Namespaces to plant decoys in. Empty means the release namespace. |
| `decoys.*` | | Which decoy Secrets to plant in each namespace, and their names (default <namePrefix>-platform-admin and <namePrefix>-registry-push). Rename one if it collides with a real Secret or an ignore rule. |
| `decoys.adminToken.enabled` | `true` |  |
| `decoys.adminToken.name` | `""` |  |
| `decoys.registry.enabled` | `true` |  |
| `decoys.registry.name` | `""` |  |
| `ignore` | `[]` | .lilyignore patterns for this release (gitignore syntax), on top of the workspace's rules. They match k8s/<namespace>/secrets/<name>. Before installing or upgrading, a hook Job checks every decoy Secret; if any is ignored, the release stops before a decoy is created. Turn that decoy off or rename it. |
| `policyCheck.enabled` | `true` |  |
| `rotate` | `"1"` | Change to rotate every decoy (e.g. --set rotate=$(date +%s)). Without a change, upgrades keep the same values. GitOps tools that render without cluster access (Argo CD) can't read the current values back, so pin them with tokens.* instead. |
| `tokens.adminToken` | `""` |  |
| `tokens.registryPassword` | `""` |  |
| `registration.image` | `curlimages/curl:8.11.1` |  |
| `registration.resources.requests` | `{ cpu: 10m, memory: 16Mi }` |  |
| `registration.resources.limits` | `{ memory: 64Mi }` |  |
<!-- /gen -->

## Counts against your plan

Each Helm release is one environment. A release with no registration for 90 days shows as stale.
