# Lilytrap GitHub Action

Plants decoys in your build output and alerts you when an AI agent reverse-engineering your app follows them.

Add it after your build step and before deploy:

```yaml
permissions:
  contents: read
  id-token: write   # Lilytrap verifies the run with GitHub OIDC; no secret needed

steps:
  - run: npm run build
  - uses: lilytrap/lilytrap@v0
    with:
      path: dist
      workspace: ws_...   # from https://app.lilytrap.com
```

| Input | Default | |
|---|---|---|
| `path` | required | Build output directory |
| `workspace` | | Your workspace id (`ws_...`) |
| `target` | `web` | `web` for a built JS app, `files` for any packaged directory |
| `density` | `medium` | `low`, `medium` or `high` |
| `api` | `https://api.lilytrap.com` | |
| `endpoint` | looked up from `api` | Trap URL the decoys point at |

Lilytrap never receives your source code or build output: only the repository name, commit SHA, run ID and hashes of the decoys.

## Infrastructure

The same detection for cloud accounts, clusters and machines:

- `terraform/aws`, `terraform/gcp`, `terraform/azure`: a decoy break-glass secret (and on AWS, an optional permissionless access key), plus read detection from your own audit logs.
- `charts/lilytrap`: decoy Secrets in the namespaces you choose.
- `dist/lilytrap.mjs plant`: decoy kubeconfig, git, registry and admin credentials on a machine. `watch` reports when they're opened.

```hcl
module "lilytrap" {
  source           = "github.com/lilytrap/lilytrap//terraform/aws?ref=v0"
  lilytrap_api_key = var.lilytrap_api_key
}
```

Full instructions: https://lilytrap.com/setup.md

Set up with your coding agent: _Read https://lilytrap.com/setup.md and set up Lilytrap for this repository._

[Terms](https://lilytrap.com/terms.html) · [Privacy](https://lilytrap.com/privacy.html)
