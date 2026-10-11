# GitHub Action

The Action plants decoys in your build output after the build and before deploy. Each build gets fresh decoys. Lilytrap receives only their hashes.

## Add it

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write          # Lilytrap verifies the run with GitHub OIDC
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: lilytrap/lilytrap@v0
        with:
          path: dist           # the build output directory
          target: web          # web or files
          workspace: ws_...    # your workspace id
      # … deploy steps …
```

Put the step:

- after the step that builds what you deploy,
- before any deploy, upload, publish or `docker build` step,
- only in production release workflows. Not in pull-request or test workflows.

Keep every permission the job already has. Add `id-token: write`.

## Inputs

<!-- gen:action-inputs -->
| Input | Required | Default | What it does |
|---|---|---|---|
| `path` | yes |  | Built artifact directory (e.g. dist/) |
| `target` | no | `web` | web (built JS app) or files (drop lures into any packaged directory) |
| `endpoint` | no |  | Trap base URL the lures point at. Looked up from `api` when omitted. |
| `density` | no | `medium` | low \| medium \| high |
| `workspace` | no |  | Lilytrap workspace id (ws_...). With `permissions: id-token: write`, the run authenticates via GitHub OIDC; no secret needed. |
| `api` | no | `https://api.lilytrap.com` | Lilytrap control API URL to register the build with |
| `api-key` | no |  | Workspace API key, for runs without GitHub OIDC. Pass it from a secret. |
| `ignore` | no |  | Extra .lilyignore patterns (gitignore syntax), one per line: paths in `path` Lilytrap must never write to or patch. The workspace's own rules always apply too. |
| `ignore-file` | no |  | Ignore file to use instead of .lilyignore in the working directory. |
<!-- /gen -->

Output: `manifest`, the path of the build manifest. It is written to the runner's temp directory, outside the artifact. Never ship it.

## Choose `path` and `target`

| Project | `target` | `path` |
|---|---|---|
| Vite, webpack, esbuild, Parcel | `web` | `dist` |
| Create React App | `web` | `build` |
| Next.js static export | `web` | `out` |
| Angular | `web` | `dist/<project>/browser` |
| Docker image | `files` | the build context directory, before `docker build` |
| Android | `files` | `app/src/main/assets`, before the Gradle assemble step |
| Electron | `files` | the app's packaged resources directory, before signing |
| Anything else that ships a directory | `files` | that directory |

- `web` adds files and one guarded line to the app's entry chunk. It never changes how the app runs.
- `files` adds files. It never overwrites a file that exists.

## Keep decoys out of some files

Some files must never change: vendored bundles, signed files, anything another tool checks byte for byte. List them in `.lilyignore` at the repository root. It uses `.gitignore` syntax. Paths are relative to `path`.

```gitignore
# .lilyignore
vendor/
*.map
/index.html
```

You can also pass patterns in the `ignore` input, one per line. The workspace's own ignore rules always apply on top. See [configuration.md](configuration.md#ignore-rules).

## Authentication

- **GitHub OIDC (recommended).** Set `workspace` and `permissions: id-token: write`. The run proves its repository owner to Lilytrap. The workspace accepts builds only from its GitHub owner.
- **API key.** For runners without OIDC. Store the key as a secret and pass `api-key: ${{ secrets.LILYTRAP_API_KEY }}`.

## Deployments and plan limits

Builds of one repository group into one deployment per workflow and path. A repository counts once against your plan, however many workflows it has.

Before planting, the Action asks Lilytrap whether this repository fits the plan. If the workspace is full, the Action plants nothing, prints a warning annotation, and the build passes. Upgrade, or retire a deployment you no longer use, to free a slot.

## Other CI

The Action runs the CLI. Any CI can run it directly with Node 20 or newer:

```bash
curl -fsSLo lilytrap.mjs https://raw.githubusercontent.com/lilytrap/lilytrap/v0/dist/lilytrap.mjs
LILYTRAP_API_KEY=<key> node lilytrap.mjs inject --path dist --target web --api https://api.lilytrap.com --out "$TMPDIR/lilytrap-manifest.json"
```

- Keep `--out` outside the build output.
- The CLI finds the repository name from GitLab, Bitbucket or CircleCI variables, or from the git remote. Every build of a repository then counts as one deployment. Pass `--deployment <key>` to name it yourself.

See [cli.md](cli.md) for every flag.
