# Alerts

## Events and incidents

An **event** is one sighting of a decoy:

| Source | Means |
|---|---|
| `trap` | A decoy credential was used against Lilytrap's trap |
| `audit` | A cloud audit log saw a decoy read |
| `host` | `lilytrap watch` saw a decoy file opened |

Events from one actor group into one **incident**. The actor is an identity from an audit log, a host user, or an IP.

A **swarm** is still one incident. Agents often rotate through many IPs. When a new IP uses a decoy credential that an open incident used in the last hour, it joins that incident.

Severity:

| Severity | When |
|---|---|
| `low` | A secret scanner checked a leaked value |
| `medium` | A decoy was read, or its path was probed |
| `high` | A decoy credential was used |
| `critical` | A likely AI agent used it, or several decoys along the trail |

Classification: `likely-llm`, `scanner`, `unknown` or `internal`. Events from [internal identities](configuration.md#internal-identities) are `internal` and never alert.

Incident status: `open`, `acknowledged`, `fixing` or `resolved`. A new event on a resolved incident reopens it.

## Which destination gets what

| Destination | Gets |
|---|---|
| Email, Slack, PagerDuty | An incident opens, reopens or gets more severe. Once more when a swarm reaches 5 IPs. |
| GitHub coding agent | An incident opens or reopens. One incident starts one agent run. |
| Webhook | Every event |
| Splunk, Sentinel | Every event, as one flat row |

Deployments that go quiet are reported once, to email, Slack, the webhook and the SIEMs. Quiet means no build, plan, upgrade or heartbeat for 30 days (CI, Terraform), 90 days (Helm) or 3 days (hosts running `watch`). They never page.

Set destinations in [`lilytrap.json`](configuration.md), or with `PUT /agent/v1/settings` (see [api.md](api.md#settings)).

## Email

```json
"alerts": { "email": "security@example.com" }
```

## Slack

Create an incoming webhook in Slack. Then:

```json
"alerts": { "slack": "${LILYTRAP_SLACK_WEBHOOK}" }
```

## PagerDuty

Create an Events API v2 integration on a PagerDuty service. Use its routing key:

```json
"alerts": { "pagerduty": "${LILYTRAP_PAGERDUTY_KEY}" }
```

Resolving the incident in Lilytrap resolves it in PagerDuty.

## Webhook

```json
"alerts": { "webhook": { "url": "https://hooks.example.com/lilytrap", "secret": "${LILYTRAP_WEBHOOK_SECRET}" } }
```

Lilytrap sends `POST` with a JSON body. Two types:

```json
{ "type": "trap.triggered", "event": { … }, "incident": { … }, "change": "opened", "prompt": "<incident brief markdown>" }
```

```json
{ "type": "deployment.stale", "deployments": [ { "key": "…", "name": "…", "kind": "helm", "lastSeen": "…", "staleAfterDays": 90 } ] }
```

- `change` is `opened`, `reopened`, `escalated` or `updated`.
- `prompt` is the incident brief. Hand it to a coding agent as a task.

### Verify the signature

Every request has `x-lilytrap-signature: sha256=<hex>`. It is an HMAC-SHA256 of the raw request body, keyed with your webhook secret. Check it before acting:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header?.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Use the raw bytes. Parsing and re-serializing the JSON changes them.

## GitHub coding agent

Lilytrap can start a coding agent in GitHub Actions for each new incident. It dispatches a workflow named `lilytrap-incident.yml` with the brief as input.

1. Add `.github/workflows/lilytrap-incident.yml`. With Claude Code:

```yaml
name: Lilytrap incident
on:
  workflow_dispatch:
    inputs:
      prompt: { description: "Lilytrap incident brief", required: true }
      event_id: { required: true }
      classification: { required: false }
      llm_score: { required: false }
permissions:
  contents: write
  pull-requests: write
  id-token: write
jobs:
  investigate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: ${{ inputs.prompt }}
```

   For another agent, replace the last step. Pass `${{ inputs.prompt }}` through an environment variable, never inline in a shell script.

2. Add `.github/workflows/lilytrap-resolve.yml`. It marks the incident resolved when the agent's fix merges. It needs `LILYTRAP_API_KEY` as a repository secret.

```yaml
name: Lilytrap resolve
on:
  pull_request:
    types: [closed]
jobs:
  resolve:
    if: github.event.pull_request.merged && startsWith(github.head_ref, 'lilytrap/inc_')
    runs-on: ubuntu-latest
    steps:
      - env:
          LILYTRAP_API_KEY: ${{ secrets.LILYTRAP_API_KEY }}
          BRANCH: ${{ github.head_ref }}
          PR: ${{ github.event.pull_request.html_url }}
        run: |
          ID="${BRANCH#lilytrap/}"
          [[ "$ID" =~ ^inc_[a-z0-9]+$ ]] || exit 0
          curl -fsS -X PUT "https://api.lilytrap.com/agent/v1/incidents/$ID" \
            -H "authorization: Bearer $LILYTRAP_API_KEY" -H 'content-type: application/json' \
            -d "{\"status\":\"resolved\",\"pullRequest\":\"$PR\"}"
```

3. **Ask the human** for a fine-grained GitHub token for this one repository with only **Actions: Read and write**. No Contents permission.

```json
"alerts": { "github": { "repo": "acme/web", "token": "${LILYTRAP_GITHUB_TOKEN}" } }
```

## Splunk

1. **Ask the human** for an HTTP Event Collector token. The HEC endpoint needs a publicly trusted certificate. Splunk Cloud has one.
2. Add it:

```json
"alerts": { "splunk": { "url": "https://http-inputs-<stack>.splunkcloud.com/services/collector/event", "token": "${LILYTRAP_SPLUNK_TOKEN}", "index": "security" } }
```

Events arrive with `sourcetype=lilytrap`. `index` is optional. Without it, the token's default index is used.

## Microsoft Sentinel

1. Add the module next to the Sentinel workspace. It creates the `Lilytrap_CL` table, a data collection endpoint and rule, and an Entra app that can only send to that rule.

```hcl
module "lilytrap_sentinel" {
  source                     = "github.com/lilytrap/lilytrap//terraform/azure/modules/sentinel?ref=v0"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.sentinel.id
  resource_group_name        = azurerm_resource_group.security.name
  location                   = azurerm_resource_group.security.location
}
```

2. After apply, `terraform output -raw lilytrap_config` prints the `sentinel` block. Put it under `alerts`. Move the client secret to an environment variable and write `"clientSecret": "${LILYTRAP_SENTINEL_SECRET}"`.

The module's inputs are in [terraform.md](terraform.md#microsoft-sentinel-export).

## Test a SIEM connection

```bash
curl -sS -X POST https://api.lilytrap.com/agent/v1/siem/test -H "authorization: Bearer $LILYTRAP_API_KEY"
```

It sends one `lilytrap.test` row to each configured SIEM. It returns each answer: `{"results":[{"destination":"splunk","ok":true}]}`. A `409 not_configured` means no SIEM is set.

## SIEM columns

Every row has the same columns, in Splunk and in Sentinel:

| Column | Contents |
|---|---|
| `TimeGenerated` | When it happened |
| `RecordType` | `trap.triggered`, `deployment.stale` or `lilytrap.test` |
| `WorkspaceId` | The workspace id |
| `EventId` | The event id |
| `IncidentId` | The incident id |
| `IncidentChange` | `opened`, `reopened`, `escalated` or `updated` |
| `Severity` | `low`, `medium`, `high` or `critical` |
| `Classification` | `likely-llm`, `scanner` or `unknown` |
| `LlmScore` | 0 to 1: how likely the actor is an AI agent |
| `SourceIp` | The client IP |
| `Method`, `Path`, `UserAgent` | The request that used the decoy |
| `Kit` | What kind of decoy it was |
| `TokenId` | Which decoy. Rotate it after the fix. |
| `BuildId` | The build or deployment that planted it |
| `MatchedBy` | `secret`, `path`, `resource` or `file` |
| `EventSource` | `trap`, `audit` or `host` |
| `Principal` | The identity, from an audit log or a host |
| `IncidentEvents`, `IncidentIps` | The incident's event count and IP count |
| `Url` | Dashboard link |
| `Reasons` | Why it was classified as it was |
| `Details` | The full event, incident or deployment as JSON |

## Poll instead

```bash
curl -sS "https://api.lilytrap.com/agent/v1/incidents?status=open" -H "authorization: Bearer $LILYTRAP_API_KEY"
curl -sS "https://api.lilytrap.com/agent/v1/incidents/<id>" -H "authorization: Bearer $LILYTRAP_API_KEY"   # includes the brief as "prompt"
```
