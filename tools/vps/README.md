# Driftora backend: CI-gated pull deployment

The `driftora-release.timer` on the production host checks `master` every two minutes. It deploys only when the latest push CI run for that exact SHA succeeds. PR CI cannot authorize production. No Mac connection or GitHub-held server key is required; the public repository is fetched over HTTPS.

The root-owned `/usr/local/sbin/driftora-release` builds the selected commit as the unprivileged `foodproxy` user in `/opt/healthroutine-food/.releases/SHA`. Existing `/opt/healthroutine-food/.env` and `data/` remain the authoritative runtime state. Database files, credentials, VPN services and Caddy/nginx are not replaced.

A candidate first starts on loopback port 18787 and must pass `/health`. Only then a systemd drop-in switches the food service working directory. The process cwd and local/external health are checked; failure restores the previous drop-in and restarts the previous version. A newer master arriving during build supersedes the candidate. Documentation/app-only changes with an unchanged server tree advance source metadata without restarting the backend.

Install the reviewed script as root mode 0755, install the adjacent service/timer into `/etc/systemd/system`, run `systemctl daemon-reload`, then `systemctl enable --now driftora-release.timer`. First run can be triggered with `systemctl start driftora-release.service`. The installed root-owned deployment script is updated deliberately during infrastructure work, not executed from a mutable project checkout.

Status and protected build logs: `/var/lib/driftora-release/`. `status.json` distinguishes current source SHA from runtime build SHA. The original pre-release working directory is preserved for rollback. This changes server/backend delivery only; mobile APK/store publication has its own release workflow.
