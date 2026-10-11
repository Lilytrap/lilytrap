# Configuration

A workspace's settings live in one file, `lilytrap.json`. Commit it next to the code. Apply it with the CLI. Prefer it to one-off API calls, because a file can be reviewed and reapplied.

## The file

Every key is optional.

```json
{
  "$schema": "https://lilytrap.com/schema/lilytrap.json",
  "alerts": {
    "email": "security@example.com",
    "slack": "${LILYTRAP_SLACK_WEBHOOK}",
    "webhook": { "url": "https://hooks.example.com/lilytrap", "secret": "${LILYTRAP_WEBHOOK_SECRET}" },
    "pagerduty": "${LILYTRAP_PAGERDUTY_KEY}",
    "github": { "repo": "acme/web", "token": "${LILYTRAP_GITHUB_TOKEN}" },
    "splunk": { "url": "https://http-inputs-acme.splunkcloud.com/services/collector/event", "token": "${LILYTRAP_SPLUNK_TOKEN}", "index": "security" },
    "sentinel": {
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "clientId": "00000000-0000-0000-0000-000000000000",
      "clientSecret": "${LILYTRAP_SENTINEL_SECRET}",
      "endpoint": "https://lilytrap-abcd.eastus-1.ingest.monitor.azure.com",
      "dcrId": "dcr-00000000000000000000000000000000",
      "stream": "Custom-Lilytrap"
    }
  },
  "internalIdentities": ["10.0.0.0/8", "arn:aws:iam::123456789012:role/ci-*", "exe:/usr/bin/restic"],
  "ignore": ["vendor/", "*.map", "aws/*/s3/", "k8s/kube-system/"],
  "respond": {
    "blocklist": { "minSeverity": "high", "ttlHours": 24, "allow": ["203.0.113.0/24"] },
    "awsWaf": { "roleArn": "arn:aws:iam::123456789012:role/lilytrap-block-waf", "ipSets": ["arn:aws:wafv2:…"] }
  }
}
```

| Key | What it sets | Docs |
|---|---|---|
| `alerts.email` | Where incident email goes | [alerts.md](alerts.md#email) |
| `alerts.slack` | A Slack incoming webhook URL | [alerts.md](alerts.md#slack) |
| `alerts.webhook` | `url` and the signing `secret` | [alerts.md](alerts.md#webhook) |
| `alerts.pagerduty` | A PagerDuty Events API v2 routing key | [alerts.md](alerts.md#pagerduty) |
| `alerts.github` | A repository and an Actions-only token, to start a coding agent | [alerts.md](alerts.md#github-coding-agent) |
| `alerts.splunk` | A Splunk HEC endpoint and token | [alerts.md](alerts.md#splunk) |
| `alerts.sentinel` | A Sentinel data collection rule and app | [alerts.md](alerts.md#microsoft-sentinel) |
| `internalIdentities` | Your own tools and networks. They never alert. | [below](#internal-identities) |
| `ignore` | Places decoys must never go | [below](#ignore-rules) |
| `respond.blocklist` | What the block list serves | [blocking.md](blocking.md) |
| `respond.awsWaf` | The role and IP sets for AWS WAF | [blocking.md](blocking.md#aws-waf) |

## Rules of the file

- A key left out is left unchanged.
- `null` clears a key. `"respond": {"blocklist": null}` resets the block list to its defaults.
- `${NAME}` reads an environment variable. Secrets never go in the file. Applying fails if a variable isn't set.
- Secrets are write-only. `config pull` leaves them out and names them in a warning. Add them as `${…}` to manage them from the file. Left out, they stay as they are.
- Unknown keys are errors. `config validate` names them.
- Add `$schema` for editor completion.

## Commands

```bash
export LILYTRAP_API_KEY=<key>
node lilytrap.mjs config pull                 # write what the workspace has now
node lilytrap.mjs config validate             # check the file offline
node lilytrap.mjs config apply --dry-run      # show what would change
node lilytrap.mjs config apply                # change it
```

Use `--file <path>` for a file other than `lilytrap.json`. `--file -` writes `pull` to stdout.

To apply on every merge, run it in a workflow:

```yaml
on:
  push:
    branches: [main]
    paths: [lilytrap.json]
jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: curl -fsSLo lilytrap.mjs https://raw.githubusercontent.com/lilytrap/lilytrap/v0/dist/lilytrap.mjs
      - run: node lilytrap.mjs config apply
        env:
          LILYTRAP_API_KEY: ${{ secrets.LILYTRAP_API_KEY }}
          LILYTRAP_SLACK_WEBHOOK: ${{ secrets.LILYTRAP_SLACK_WEBHOOK }}
```

## Ignore rules

Ignore rules list places Lilytrap must never write a decoy. They use `.gitignore` syntax:

- `*` and `?` match within one path segment. `**` matches any number of segments.
- A pattern with a slash in the middle, or a leading `/`, is anchored to the root.
- A pattern without a slash matches a name at any depth.
- A trailing `/` matches a directory and everything under it.
- `!pattern` re-includes a path an earlier pattern ignored, unless a parent directory is ignored.
- `#` starts a comment.

There are three places to write them:

| Where | Applies to |
|---|---|
| `ignore` in `lilytrap.json` | Every deployment in the workspace. Nothing can re-include what it ignores. |
| `.lilyignore` in a repository, or `--root` on a host | That repository's builds, or that host |
| The `ignore` input or value of the Action, a Terraform module or the Helm chart | That one deployment |

Paths depend on where the decoy goes:

| Decoy | Path |
|---|---|
| Build output | Relative to the Action's `path` |
| A host | Relative to `plant --root` |
| AWS secret | `aws/<account>/<region>/secretsmanager/<name>` |
| AWS SSM parameter | `aws/<account>/<region>/ssm/<name>` |
| AWS S3 object | `aws/<account>/s3/<bucket>/<key>` |
| AWS IAM user | `aws/<account>/iam/users/<name>` |
| Google Cloud secret | `gcp/<project>/secretmanager/<id>` |
| Azure Key Vault secret | `azure/<vault>/secrets/<name>` |
| Kubernetes Secret | `k8s/<namespace>/secrets/<name>` |

What happens when a decoy's path is ignored:

- The Action and `plant` skip it.
- A registration that planted at an ignored path is refused with `422 ignored_path`.
- Terraform and Helm check before creating anything. A required decoy that's ignored fails the plan or the release.

Check paths before you commit a rule:

```bash
node lilytrap.mjs ignore check dist/vendor/app.js aws/123456789012/us-east-1/secretsmanager/prod-admin
```

Limits: 200 patterns, 300 characters each.

## Internal identities

Backup jobs, config management and security scanners may touch decoys on purpose. List them in `internalIdentities`. Their events are labelled `internal`. They never alert or reach the block list.

| Entry | Matches |
|---|---|
| `203.0.113.7`, `10.0.0.0/8`, `2001:db8::/32` | A source IP or CIDR |
| `arn:aws:iam::123456789012:role/ci-*` | An AWS principal, with `*` wildcards |
| `*@my-project.iam.gserviceaccount.com` | A Google Cloud principal |
| An Azure object id or UPN | An Azure principal |
| `exe:/usr/bin/restic` | A process on a host, exact or with `*` |

Limit: 100 entries.

The identity that applies a Terraform module is trusted for that module automatically. Add others with the module's `trusted_identities`.
