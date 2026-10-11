# Troubleshooting

Every API error has a code in `error`. Most also have a `message` that says what to do. Find the code below.

## Builds and the Action

### Warning "Lilytrap plan limit", and nothing planted

The workspace protects as many repos or environments as its plan allows. The build passed without decoys.

- See usage: `GET /agent/v1/stats` returns `usage.used` and `usage.limit`.
- Free a slot: `GET /agent/v1/deployments`, then `DELETE /agent/v1/deployments?key=<key>` for one that's no longer used.
- Or upgrade under Settings in the dashboard.

The API returns this as `402 plan_limit`. Builds of a repo that already has a slot always register.

### `401 unauthorized` in GitHub Actions

Check, in order:

1. The job has `permissions: id-token: write`.
2. The `workspace` input is the right `ws_…` id.
3. The workspace's GitHub owner matches the repository's owner. `GET /agent/v1/me` shows `tenant.githubOwner`. Fix it with `PUT /agent/v1/tenant {"githubOwner":"<owner>"}`.
4. A fork's pull request has no OIDC token. Run the step only in release workflows.

### `401 unauthorized` with an API key

The key is wrong or was rotated. Keys start with `wsk_`. `POST /agent/v1/api-keys` makes a new one and revokes the old one.

### `422 ignored_path`

A decoy was planted at a path the workspace's ignore rules exclude. Usually the CLI is older than the rules. Use `@v0` or a recent release. Check paths with `node lilytrap.mjs ignore check <path>...`.

### `409 decoy_conflict`

The build contains a decoy secret that another workspace registered first. A decoy belongs to the workspace that registered it. Plant fresh decoys with a new build. Never copy decoys between workspaces.

### `429 rate_limited` or `429 too_many_signups`

`rate_limited`: too many requests from one IP address. Wait a few minutes. `too_many_signups`: 5 workspaces were already created for that GitHub owner today. Use the existing workspace's API key. See [api.md](api.md#limits).

### `400 invalid_manifest`

The build manifest is malformed. Don't edit it by hand. Re-run the step.

### The app broke after adding the step

It shouldn't. `web` adds one guarded line to the entry chunk. If something checks files byte for byte, list them in `.lilyignore`. See [github-action.md](github-action.md#keep-decoys-out-of-some-files). Don't remove the step.

## Terraform and Helm

### Plan fails: a decoy is ignored

A required decoy's resource path matches an ignore rule. Rename it with `secret_name` or `secret_id`, or change the rule. See [terraform.md](terraform.md).

### Helm release stops at the policy check

```bash
kubectl logs job/<release>-lilytrap-policy-check -n <namespace>
```

It names the ignored decoy. Turn it off, rename it, or drop the namespace. See [kubernetes.md](kubernetes.md#when-the-policy-check-fails).

### Reads of the AWS decoy aren't reported

- The account needs a CloudTrail trail recording management events, or `create_trail = true`.
- Events land in the region where they happen. Add a [forwarder](terraform.md#other-regions) for each other region.
- Identities in `trusted_identities` are ignored on purpose.

### A deployment shows as stale

Nothing heard for 30 days (CI, Terraform), 90 (Helm) or 3 (hosts with `watch`). Run a build, a plan or an upgrade. On a host, check that `watch` is running. If it's gone for good, retire it.

## Alerts

### Webhook signature doesn't match

Compute the HMAC over the raw request body, not re-serialized JSON. See [alerts.md](alerts.md#verify-the-signature).

### No alert on every event

By design. Email, Slack and PagerDuty fire when an incident opens, reopens or gets more severe. The webhook and SIEMs get every event.

### `409 not_configured` from `/siem/test`

No SIEM is set. Add `alerts.splunk` or `alerts.sentinel` and apply.

### SIEM test fails

| `error` in the result | Fix |
|---|---|
| Splunk 401 or 403 | Wrong HEC token, or the token is disabled |
| Splunk 400 "Incorrect index" | The token isn't allowed to write to `index` |
| Splunk certificate error | The HEC endpoint needs a publicly trusted certificate |
| Sentinel token error | Wrong `tenantId`, `clientId` or `clientSecret`, or the secret expired |
| Sentinel 403 | The app lacks Monitoring Metrics Publisher on the rule. Role changes take a few minutes. |
| Sentinel 404 | Wrong `endpoint`, `dcrId` or `stream` |

### `400 invalid_settings`

The `message` names the field. `node lilytrap.mjs config validate` catches most of these offline.

## Blocking

### AWS WAF status shows `AccessDenied`

- The role must trust Lilytrap's account with your workspace id as external ID. `GET /agent/v1/settings` shows both under `awsTrust`.
- The role name must start with `lilytrap`.
- The role can only touch the IP sets it was made for. Check `ipSets` in `lilytrap.json` matches the module output.

### `409 not_configured` from `/respond/aws-waf/sync`

`respond.awsWaf` isn't set.

### The feed returns 401

Wrong or revoked feed key. Feed keys start with `lbf_`. The workspace API key doesn't work here. Create a new feed key with `POST /agent/v1/blocklist/key`.

### An IP I expected isn't on the list

It's not listed if its incident is resolved or below `minSeverity`, its last event is older than `ttlHours`, or it's private, internal, allowed or a scanner. See [blocking.md](blocking.md#whats-on-the-list).

## Anything else

Email support@lilytrap.com with the workspace id and the request id or error. Never send the API key.
