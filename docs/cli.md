# CLI

`dist/lilytrap.mjs` is the whole CLI in one file. It has no dependencies. It needs Node 20 or newer.

```bash
curl -fsSLo lilytrap.mjs https://raw.githubusercontent.com/lilytrap/lilytrap/v0/dist/lilytrap.mjs
node lilytrap.mjs --help
```

Commands that talk to Lilytrap need a workspace API key in `LILYTRAP_API_KEY`. In GitHub Actions, `inject` can use OIDC instead (see [github-action.md](github-action.md#authentication)).

## Commands

| Command | Use it to | Docs |
|---|---|---|
| `inject` | Plant decoys in build output in CI | [github-action.md](github-action.md#other-ci) |
| `plant` | Plant decoy credentials on a machine | [servers.md](servers.md) |
| `watch` | Report when a planted file is opened, and check in | [servers.md](servers.md#watch) |
| `config pull` | Write the workspace's settings to `lilytrap.json` | [configuration.md](configuration.md) |
| `config apply` | Make the workspace match `lilytrap.json` | [configuration.md](configuration.md) |
| `config validate` | Check `lilytrap.json` offline | [configuration.md](configuration.md) |
| `ignore check` | Show which paths the ignore rules exclude, and why | [configuration.md](configuration.md#ignore-rules) |

## Full help

<!-- gen:cli-help -->
```text
lilytrap: plant LLM-bait breadcrumbs in your build and catch whoever follows them

Usage:
  lilytrap inject --path <dir> [--endpoint <trap-url>] [options]
  lilytrap plant [--root <dir>] [--rotate]
  lilytrap watch
  lilytrap config pull|apply|validate [--file lilytrap.json] [--dry-run]
  lilytrap ignore check <path>... [--ignore-file <f>] [--ignore <pattern>]
  lilytrap collector [options]      (source checkout only)
  lilytrap demo                     (source checkout only)

.lilyignore: paths Lilytrap must never write to, in .gitignore syntax. inject reads it from the
working directory (the repo root in CI); plant from the working directory, then --root. The
workspace's own rules (lilytrap config, or the dashboard) always apply on top and can't be
re-included locally.
  --ignore-file <file>   use this file instead
  --ignore <pattern>     extra pattern; repeatable

config: the workspace's settings as a file: alerts, SIEM export, internal identities, ignore
rules, the block list and AWS WAF. Needs LILYTRAP_API_KEY. Keys left out of the file are left alone; null clears. Strings may use ${ENV}.
  pull                   write the current config (--file - for stdout)
  apply                  make the workspace match the file (--dry-run to preview)
  validate               check the file offline
  --file <path>          default lilytrap.json

plant: decoy credentials on a machine (kubeconfig, git and registry credentials, an admin env
file, an on-call handoff note). Never overwrites existing files. Needs LILYTRAP_API_KEY.
  --root <dir>           where to plant (default: your home directory)
  --api <url>            default https://api.lilytrap.com
  --rotate               remove the previous decoys (from the state file) and plant fresh ones
  --state <file>         default /var/lib/lilytrap/state.json as root, else ~/.lilytrap/state.json
  --hostname <name>      how this machine shows up in alerts
  Optional: LILYTRAP_DECOY_AWS_KEY_ID / LILYTRAP_DECOY_AWS_SECRET plant the permissionless AWS key
  from the Terraform module as a break-glass profile.

watch: report when a planted decoy file is opened (Linux: auditd as root, or inotify-tools).
Also checks in every 6 hours, so the dashboard can tell when a host has gone away.
  --state <file>  --mode auditd|inotify

inject options:
  --target web|files     web = built JS app (default), files = drop into any packaged dir
  --path <dir>           built artifact directory (e.g. dist/)
  --endpoint <url>       trap base URL the lures point at (default: looked up from --api)
  --density low|medium|high
  --api <url>            collector control API to register the build with
  --api-key <key>        (or LILYTRAP_API_KEY); GitHub OIDC token in LILYTRAP_OIDC_TOKEN takes precedence
  --workspace <id>       workspace id (required with OIDC)
  --out <file>           manifest path (default lilytrap-manifest.json). Keep it OUT of the artifact.
  --seed <hex>           reproduce a previous build's lures
  --ignore, --ignore-file  see .lilyignore above
  --deployment <key>     what this is a build of, so builds group into one deployment
                         (default: ci:<repo>:<workflow file>:<path>; the repo comes from the CI's
                         variables or the git remote)
```
<!-- /gen -->

## Exit codes

- `0`: success. A build skipped because the plan is full is also `0`. It prints a warning.
- `1`: anything failed. The message says what. API errors include the API's `message`.
