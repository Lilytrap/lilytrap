# Lilytrap

Lilytrap catches AI agents that break into your software.

It plants decoys where an agent goes looking: fake credentials, fake internal API keys and fake "handoff" notes. They go in your build output, your cloud accounts, your Kubernetes clusters and your servers. A real user never sees them. An agent reading your code or your infrastructure finds them and tries them. When that happens, Lilytrap alerts you, tells you where the decoy was found, and can block the attacker at your edge.

- Website: https://lilytrap.com
- Dashboard: https://app.lilytrap.com
- Setup for coding agents: [`docs/setup.md`](docs/setup.md), also at https://lilytrap.com/setup.md
- Instructions for agents working in this repository: [`AGENTS.md`](AGENTS.md)

## How it works

1. **Plant.** A GitHub Action step (or the CLI, a Terraform module, a Helm chart or a server command) adds decoys. Each decoy is unique to one build or one deployment.
2. **Register.** Lilytrap's API receives only hashes of the decoys, plus where they were planted. It never receives your code, your build output or any real secret.
3. **Detect.** Using a decoy hits Lilytrap's trap endpoint. Reading a cloud decoy shows up in your own audit logs, which forward to Lilytrap.
4. **Alert.** Events from one attacker group into one incident. A swarm of IPs using the same decoy is still one incident. You get email, Slack, PagerDuty, a webhook, Splunk or Microsoft Sentinel. A brief for your coding agent explains what leaked and how to fix it.
5. **Respond.** Lilytrap can push attacker IPs into AWS WAF. Other firewalls can poll a block-list feed.

## Quick start

### Let your coding agent do it

Paste this into Claude Code, Codex, Cursor or any coding agent, in your repository:

```text
Read https://lilytrap.com/setup.md and set up Lilytrap for this repository.
```

The agent creates a workspace, opens a pull request, and gives you a one-time code to open the dashboard.

### Do it yourself

1. Sign in at https://app.lilytrap.com with GitHub. Copy your workspace id (`ws_…`) from Settings.
2. Add one step after your build and before deploy:

```yaml
permissions:
  contents: read
  id-token: write   # Lilytrap verifies the run with GitHub OIDC. No secret needed.

steps:
  - run: npm run build
  - uses: lilytrap/lilytrap@v0
    with:
      path: dist
      workspace: ws_...
```

3. Merge. Every production build now ships fresh decoys.

Full reference: [`docs/github-action.md`](docs/github-action.md).

## What you can protect

| Where | How | Docs |
|---|---|---|
| Web apps, containers, mobile and desktop builds | GitHub Action, or the CLI in any CI | [GitHub Action](docs/github-action.md), [CLI](docs/cli.md) |
| AWS accounts | Terraform module `terraform/aws` | [Terraform](docs/terraform.md#aws) |
| Google Cloud projects | Terraform module `terraform/gcp` | [Terraform](docs/terraform.md#google-cloud) |
| Azure Key Vaults | Terraform module `terraform/azure` | [Terraform](docs/terraform.md#azure) |
| Anywhere else a secret can live | Terraform provider `lilytrap/lilytrap` | [Terraform](docs/terraform.md#terraform-provider) |
| Kubernetes namespaces | Helm chart `charts/lilytrap` | [Kubernetes](docs/kubernetes.md) |
| Servers, VMs, CI runners, images | `lilytrap plant` and `lilytrap watch` | [Servers](docs/servers.md) |

## Docs

| Page | What's in it |
|---|---|
| [docs/setup.md](docs/setup.md) | Step-by-step setup, written for coding agents |
| [docs/github-action.md](docs/github-action.md) | Action inputs, build targets, other CI |
| [docs/cli.md](docs/cli.md) | Every CLI command and flag |
| [docs/terraform.md](docs/terraform.md) | AWS, Google Cloud and Azure modules, the provider, and their inputs |
| [docs/kubernetes.md](docs/kubernetes.md) | The Helm chart and its values |
| [docs/servers.md](docs/servers.md) | Decoys on machines, and reporting when they're opened |
| [docs/configuration.md](docs/configuration.md) | `lilytrap.json`, ignore rules and internal identities |
| [docs/alerts.md](docs/alerts.md) | Incidents, alert destinations, webhook payloads, SIEM export |
| [docs/blocking.md](docs/blocking.md) | The block list, AWS WAF push and firewall feeds |
| [docs/api.md](docs/api.md) | The HTTP API |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Errors and what to do about them |

## What Lilytrap receives

- The repository name, commit SHA and run ID of each build.
- IDs and SHA-256 hashes of the decoys it planted.
- For infrastructure: the decoys' resource names, and audit-log entries for those decoys only. An entry includes the identity, IP and user agent that touched the decoy.
- For a decoy that was used: the request that used it.

Lilytrap never receives source code, build output, real secrets or environment variables. The GitHub Action authenticates with a short-lived GitHub OIDC token. Lilytrap never needs a token that can read your repository.

## Plans

Every feature is on every plan. Plans differ only in how many repos or environments they protect.

<!-- gen:plans -->
| Plan | Price | Repos or environments | Features |
|---|---|---|---|
| Free | $0 | 5 | All |
| Team | $20/month | 25 | All |
| Business | $99/month | 100 | All |
<!-- /gen -->

A repo counts once, however many workflows it has. Each Terraform deployment, Helm release or server counts as one environment. When a workspace is full, new builds skip planting with a warning. They never fail. Retire a deployment you no longer use to free its slot.

## Repository layout

| Path | What it is |
|---|---|
| `action.yml` | The GitHub Action |
| `dist/lilytrap.mjs` | The CLI, one file, no dependencies, Node 20+ |
| `terraform/aws`, `terraform/gcp`, `terraform/azure` | Cloud decoy modules |
| `terraform/aws/modules/forwarder` | Forwards CloudTrail events from other AWS regions |
| `terraform/aws/modules/waf-block` | IP sets and a role so Lilytrap can block in AWS WAF |
| `terraform/azure/modules/sentinel` | A Sentinel table and an app so Lilytrap can send events |
| `charts/lilytrap` | The Helm chart |
| `docs/` | Documentation |

The detection service, dashboard and trap are hosted by Lilytrap and are not in this repository. The Terraform provider is at https://github.com/lilytrap/terraform-provider-lilytrap.

## Versions

`@v0` and `?ref=v0` always point at the latest release. Each release also has its own tag (`v0.8`, `v0.9`, …). Pin one of those if you want changes only when you choose.

## Security

Report a vulnerability to support@lilytrap.com with "Security" in the subject. Don't open a public issue for it.

[Terms](https://lilytrap.com/terms.html) · [Privacy](https://lilytrap.com/privacy.html)
