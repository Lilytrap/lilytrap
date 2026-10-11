# Servers, VMs, CI runners and images

`lilytrap plant` puts decoy credentials on a machine. `lilytrap watch` reports when one is opened and checks in so Lilytrap knows the machine still exists.

Rules for agents:

- **Ask the human** which machines to protect.
- Add the commands to provisioning (cloud-init, Ansible, a Dockerfile `RUN` step) in a pull request. Don't run them on production machines yourself.
- Pass the API key from a secret store. Never bake it into an image.

## Plant

```bash
curl -fsSLo /usr/local/bin/lilytrap.mjs https://raw.githubusercontent.com/lilytrap/lilytrap/v0/dist/lilytrap.mjs
LILYTRAP_API_KEY=<key> node /usr/local/bin/lilytrap.mjs plant --root /home/deploy
```

`--root` is the home directory of the account an attacker would land in. The default is the current user's home.

It plants files like these, under `--root`:

| File | Looks like |
|---|---|
| `.kube/config` | A cluster-admin kubeconfig |
| `.git-credentials` | Git push credentials |
| `.docker/config.json` | Registry credentials |
| `ops/admin.env` and similar | An admin environment file |
| `ops/HANDOFF.md` and similar | An on-call handoff note |
| `.aws/credentials` | Only with `LILYTRAP_DECOY_AWS_KEY_ID` and `LILYTRAP_DECOY_AWS_SECRET` set. Use the permissionless key from the [AWS Terraform module](terraform.md#aws). |

- It never overwrites a file that exists.
- It skips paths matched by `.lilyignore` in the working directory or in `--root`, by `--ignore <pattern>`, and by the workspace's rules.
- It writes a state file: `/var/lib/lilytrap/state.json` as root, or `~/.lilytrap/state.json`. `watch` and `--rotate` read it.

## Watch

`watch` does two things:

- It reports when a decoy file is opened. As root it uses auditd. Otherwise it uses `inotifywait` from inotify-tools. Choose with `--mode auditd` or `--mode inotify`.
- It checks in every 6 hours. A host with no check-in for 3 days shows as stale.

Run it as a service. A systemd unit:

```ini
# /etc/systemd/system/lilytrap-watch.service
[Unit]
Description=Lilytrap decoy watch
After=network-online.target auditd.service

[Service]
ExecStart=/usr/bin/node /usr/local/bin/lilytrap.mjs watch
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now lilytrap-watch
```

`watch` needs no API key. It uses a per-host ingest key from the state file.

## Rotate

After an incident, the planted values are burned. Plant fresh ones:

```bash
LILYTRAP_API_KEY=<key> node /usr/local/bin/lilytrap.mjs plant --root /home/deploy --rotate
```

It removes the previous decoys listed in the state file, plants new ones, and retires the old deployment.

## Container images and CI runners

Plant during the image build so every container has decoys:

```dockerfile
RUN --mount=type=secret,id=lilytrap,env=LILYTRAP_API_KEY \
    curl -fsSLo /usr/local/bin/lilytrap.mjs https://raw.githubusercontent.com/lilytrap/lilytrap/v0/dist/lilytrap.mjs \
 && node /usr/local/bin/lilytrap.mjs plant --root /root --hostname my-image
```

Images don't run `watch`. Planted credentials still alert when used. The deployment shows as unmonitored, not stale.

## Your own tools

Backup jobs and scanners may open decoy files on purpose. Add them to `internalIdentities` as `exe:/usr/bin/restic` so they never alert. See [configuration.md](configuration.md#internal-identities).

## Decommissioning a host

Retire its deployment so it stops counting against your plan:

```bash
curl -sS -X DELETE "https://api.lilytrap.com/agent/v1/deployments?key=<deployment key>" -H "authorization: Bearer $LILYTRAP_API_KEY"
```

`GET /agent/v1/deployments` lists the keys.
