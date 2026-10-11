# HTTP API

Base URL: `https://api.lilytrap.com`

| Prefix | Who calls it | Authentication |
|---|---|---|
| `/agent/v1/` | Agents, scripts, the CLI | `Authorization: Bearer <workspace API key>` (`wsk_…`) |
| `/v1/builds`, `/v1/policy` | The GitHub Action | A GitHub OIDC token plus the workspace id. Or the API key. |
| `/feeds/v1/blocklist` | Firewalls | The feed key (`lbf_…`) |
| `/ingest/v1/{provider}` | The Terraform modules' audit forwarders and `lilytrap watch` | A per-deployment ingest key. You never call these yourself. |

- Requests and responses are JSON.
- Errors: `{"error": "<code>", "message": "<what to do>"}`. `message` is sometimes absent. See [troubleshooting.md](troubleshooting.md).
- Ids: workspaces `ws_…`, events `evt_…`, incidents `inc_…`, builds `bld_…`. Event and incident ids sort by time.

## Agent routes

Every path below is under `https://api.lilytrap.com/agent/v1`.

### Workspace

| Method | Path | Body or query | Returns |
|---|---|---|---|
| POST | `/signup` | `{name, githubOwner, email?}`. No authentication. | `{tenant, apiKey, claimCode, apiUrl, trapUrl}` |
| GET | `/config` | No authentication | `{apiUrl, trapUrl}` |
| GET | `/me` | | `{user, tenant}` |
| PUT | `/tenant` | Any of `name`, `githubOwner` | `{tenant}` |
| GET | `/stats` | | Totals, 14-day daily counts, and `usage {plan, used, limit}` |
| POST | `/api-keys` | | `{apiKey}`. The old key stops working. |

`claimCode` from signup lets the human open the dashboard once. Give it only to the human.

### Events and incidents

| Method | Path | Body or query | Returns |
|---|---|---|---|
| GET | `/events` | `limit` (max 200), `classification`, `before` (an event id) | `{events, nextBefore}` |
| GET | `/events/{id}` | | `{event}` |
| GET | `/events/{id}/prompt` | | `{prompt}`: the incident brief, as markdown |
| GET | `/incidents` | `status` (`open`, `acknowledged`, `fixing`, `resolved`), `limit` | `{incidents}` |
| GET | `/incidents/{id}` | | `{incident, events, prompt}` |
| PUT | `/incidents/{id}` | Any of `status`, `pullRequest` (https URL), `note` (max 2000 characters) | `{incident}` |

Resolving an incident resolves it in PagerDuty and takes its IPs off the block list.

### Builds and deployments

| Method | Path | Body or query | Returns |
|---|---|---|---|
| GET | `/builds` | `limit` | `{builds}`: CI builds and infrastructure deployments |
| GET | `/builds/{id}` | | `{build}` |
| DELETE | `/builds/{id}` | | `{retired}`. Its decoys stop matching. Past events stay. |
| GET | `/deployments` | | `{deployments}`: builds grouped by what they protect. Each has `key`, `kind`, `status` (`active`, `stale`, `unmonitored`), `lastSeen`. |
| DELETE | `/deployments?key=<key>` | | `{retired}`: every build of one deployment. Frees its plan slot. |

### Settings

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/settings` | | The settings view below |
| PUT | `/settings` | Any settings fields | The settings view |

Prefer [`lilytrap.json`](configuration.md) to calling these directly.

PUT fields: `slackWebhook`, `webhookUrl`, `webhookSecret`, `githubRepo`, `githubToken`, `alertEmail`, `pagerdutyKey`, `internalIdentities`, `ignore`, `blocklist`, `awsWaf`, `splunk`, `sentinel`.

- A field left out is unchanged. `""` or `[]` clears it.
- `blocklist: {}` resets to the defaults.
- `awsWaf` is `{roleArn, ipSetArns}`, or `null` to turn it off. Note `ipSetArns` here, `ipSets` in `lilytrap.json`.
- `splunk` is `{url, token?, index?}`. `sentinel` is `{tenantId, clientId, clientSecret?, endpoint, dcrId, stream?}`. Leave the secret out to keep the stored one.

The view hides secrets. It returns `webhookSecretSet`, `githubTokenSet`, `pagerdutySet`, `splunk.tokenSet` and `sentinel.secretSet` instead. It also returns `blocklistKeySet` and `awsTrust {accountId, externalId}` for setting up the AWS WAF role.

### Block list and response

| Method | Path | Returns |
|---|---|---|
| GET | `/blocklist` | `{generatedAt, entries}`: what the feed serves now |
| POST | `/blocklist/key` | `{key, url}`: a new feed key. Revokes the previous one. |
| DELETE | `/blocklist/key` | `{revoked}`. Turns the feed off. |
| GET | `/respond/aws-waf` | `{status}`: the last sync, per IP set. `null` when off. |
| POST | `/respond/aws-waf/sync` | `{status}`: sync now |
| POST | `/siem/test` | `{results}`: one test row per SIEM, with each answer |

### Ignore rules

| Method | Path | Body or query | Returns |
|---|---|---|---|
| GET | `/policy` | `deployment` (optional) | `{ignore, plan?}`. With `deployment`, `plan` is `{name, limit, used, allowed}`. |
| POST | `/policy/check` | `{paths, extra?}` | `{ignored}`: which of `paths` the rules exclude |

## CI routes

The GitHub Action calls these. Other CI uses the CLI, which calls them too.

| Method | Path | Returns |
|---|---|---|
| POST | `/v1/builds` | Registers a build manifest: decoy ids and hashes. `402 plan_limit` if the plan is full. `422 ignored_path` if a decoy is at an ignored path. |
| GET | `/v1/policy?deployment=<key>` | The ignore rules, and whether this deployment fits the plan |
| POST | `/v1/policy/check` | Same as the agent route |

With OIDC, send the token as `Authorization: Bearer <token>` and the workspace id as `x-lilytrap-workspace`. The token's `repository_owner` must match the workspace's GitHub owner.

## Feed

`GET /feeds/v1/blocklist`, with the feed key as basic-auth password or bearer token. One IP per line. `?format=json` returns `{generatedAt, entries: [{ip, incidentId, severity, classification, lastSeen, expiresAt}]}`. See [blocking.md](blocking.md#firewall-feed).

## Limits

Per client IP address, enforced at the edge:

| Route | Limit |
|---|---|
| `POST /agent/v1/signup` | 10 per 5 minutes |
| Everything else on `api.lilytrap.com` | 2,000 per 5 minutes |

Over a limit returns `429` with `{"error":"rate_limited"}`. Wait a few minutes and retry.

Per workspace:

| What | Limit |
|---|---|
| New workspaces per GitHub owner | 5 per day. Over it returns `429 too_many_signups`. |
| Stored events per attacker | 1,000 per day. Past it, that attacker's events are counted, not stored or alerted. Other attackers are unaffected. |
