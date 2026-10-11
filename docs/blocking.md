# Blocking attackers

Lilytrap keeps a block list: the public IPs of attackers who used your decoys. It pushes the list into AWS WAF. Other firewalls poll it as a feed.

## What's on the list

An IP is listed while all of these hold:

- Its incident is not resolved.
- The incident's severity is at least `minSeverity`. Default: `high`.
- The incident's last event was less than `ttlHours` ago. Default: 24. Maximum: 720.

An IP is never listed when:

- it's private or reserved,
- it's an [internal identity](configuration.md#internal-identities),
- it's in `allow`,
- its incident is classified `scanner`.

Resolving an incident takes its IPs off. Swarms are listed as a whole: every IP that joined the incident.

Configure it in `lilytrap.json`:

```json
"respond": { "blocklist": { "minSeverity": "high", "ttlHours": 24, "allow": ["203.0.113.0/24"] } }
```

Put your office NAT and shared egress addresses in `allow`.

Keep `ttlHours` short. Agents rotate through proxy pools, and those addresses belong to someone else afterwards.

See what's listed now:

```bash
curl -sS https://api.lilytrap.com/agent/v1/blocklist -H "authorization: Bearer $LILYTRAP_API_KEY"
```

## AWS WAF

Lilytrap pushes the list into IP sets that your web ACL blocks. You schedule nothing:

- It updates the sets when an attacker IP appears.
- It updates them when an incident is resolved.
- It re-checks every 5 minutes, so expired IPs come off.

### 1. Create the IP sets and role

In the account and region of the web ACL, add the module. For CloudFront, use `us-east-1` and `scope = "CLOUDFRONT"`.

```hcl
module "lilytrap_waf" {
  source       = "github.com/lilytrap/lilytrap//terraform/aws/modules/waf-block?ref=v0"
  workspace_id = "ws_..."
}
```

It creates:

- two IP sets, one for IPv4 and one for IPv6,
- a role named `lilytrap-block-waf`. It can only call `wafv2:GetIPSet` and `wafv2:UpdateIPSet` on those sets. It trusts Lilytrap's AWS account, with your workspace id as the external ID.

Without Terraform, use CloudFormation:

```bash
curl -fsSLO https://lilytrap.com/aws/lilytrap-waf-block.yaml
aws cloudformation deploy --template-file lilytrap-waf-block.yaml --stack-name lilytrap-waf-block \
  --capabilities CAPABILITY_NAMED_IAM --parameter-overrides WorkspaceId=ws_...
```

Module inputs and outputs are in [terraform.md](terraform.md#blocking-in-aws-waf).

### 2. Block the IP sets in the web ACL

Add a block rule for both IP sets, ahead of the allow rules. The module's `rule_example` output is one. **Ask the human** before changing a production web ACL.

### 3. Tell Lilytrap

Put the module's `lilytrap_config` output under `respond` in `lilytrap.json`, then apply:

```json
"respond": { "awsWaf": { "roleArn": "arn:aws:iam::123456789012:role/lilytrap-block-waf", "ipSets": ["arn:aws:wafv2:…/ipset/lilytrap-block-v4/…", "arn:aws:wafv2:…/ipset/lilytrap-block-v6/…"] } }
```

Applying syncs right away. Check it:

```bash
curl -sS https://api.lilytrap.com/agent/v1/respond/aws-waf -H "authorization: Bearer $LILYTRAP_API_KEY"
```

Each IP set shows `addresses`, `changed` and any `error`.

Limits:

- 1 to 4 IP sets.
- 10,000 addresses per set.
- Use each set for Lilytrap only. Every sync replaces its whole contents.
- The role name must start with `lilytrap`.

## Firewall feed

Other firewalls poll the list over HTTPS.

### 1. Create a feed key

The feed has its own read-only key. Creating a new one revokes the old one.

```bash
curl -sS -X POST https://api.lilytrap.com/agent/v1/blocklist/key -H "authorization: Bearer $LILYTRAP_API_KEY"
# {"key":"lbf_…","url":"https://api.lilytrap.com/feeds/v1/blocklist"}
```

Store the key where the firewall can read it. `DELETE /agent/v1/blocklist/key` turns the feed off.

### 2. Read the feed

```bash
curl -sS -u "feed:$LILYTRAP_FEED_KEY" https://api.lilytrap.com/feeds/v1/blocklist
```

- One IP per line. An empty body means nothing is blocked now.
- Authenticate with basic auth: any username, the feed key as password. Or send `Authorization: Bearer <feed key>`.
- `?format=json` adds the incident, severity and expiry for each IP.
- Poll at most every minute. Every 5 minutes is enough.

### 3. Point the firewall at it

**Ask the human** which firewall or WAF guards production.

| Firewall | Setup |
|---|---|
| Palo Alto (PAN-OS) | Objects → External Dynamic Lists → type IP List. Set the feed URL, client authentication with the feed key as password, and a 5-minute refresh. Use it as the source in a deny rule above the allow rules. |
| FortiGate | Security Fabric → External Connectors → Threat Feeds → IP Address. Set the feed URL, HTTP basic authentication, and a short refresh. Use it as the source address of a deny policy. |
| Cloudflare | Sync on a schedule into an account IP list. Block it with a WAF custom rule: `ip.src in $lilytrap_block`. See below. |
| Anything that imports an IP list over HTTPS | The same URL and credentials |

Cloudflare sync, for a scheduled job:

```bash
curl -fsS -u "feed:$LILYTRAP_FEED_KEY" https://api.lilytrap.com/feeds/v1/blocklist \
  | jq -Rn '[inputs | select(length > 0) | {ip: .}]' \
  | curl -fsS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/rules/lists/$CF_LIST_ID/items" \
      -H "authorization: Bearer $CF_API_TOKEN" -H 'content-type: application/json' --data-binary @-
```
