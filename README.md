# Envelove

Envelove is a self-hosted envelope budgeting app inspired by YNAB. You enter or import your transactions; bank sync is not supported.

**Keep this installation off the public internet.** Run it on localhost or behind a private network such as [Tailscale](https://tailscale.com/). Do not forward port 3000 from your router, point a public reverse proxy at it, or use Tailscale Funnel. The email allowlist controls sign-in; it does not make this an internet-hardened service.

## Install on one host

These commands assume a Linux host with Git, Docker Engine 28 or newer, Docker Compose v2, OpenSSL, and persistent **local** disk. Run one app container per SQLite database. The host needs outbound HTTPS for image builds and to deliver mail through [Resend](https://resend.com/); no inbound mail service is needed.

```sh
git clone https://github.com/olrtg/envelove.git
cd envelove
install -m 600 .env.example .env
sudo install -d -m 700 -o 1000 -g 1000 data
openssl rand -hex 32
```

Edit `.env` before starting. Compose reads these values at runtime, not while building the image. Do not share `.env` or the output of `docker compose config`.

| Variable              | What to set                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_URL`     | The exact origin you open in the browser: `http://localhost:3000` on the host or your private HTTPS URL. No `/login` suffix.                                 |
| `BETTER_AUTH_SECRET`  | The random value generated above. Keep it across restarts and restores.                                                                                      |
| `AUTH_ALLOWED_EMAILS` | Exact addresses separated by commas, e.g. `alex@example.org,lee@example.net`. Case and spaces around entries do not matter. No domain patterns or wildcards. |
| `RESEND_API_KEY`      | A sending key for your verified domain. Restrict it to that domain.                                                                                          |
| `AUTH_EMAIL_FROM`     | A sender on that domain, e.g. `Envelove <budget@example.org>`. Add the DNS records Resend requests and wait for domain verification.                         |

```sh
docker compose up -d --build --wait
docker compose ps
```

Compose builds `envelove:local` from this checkout; there is no registry image to pull. It publishes only `127.0.0.1:3000`. For other devices, install Tailscale on the host and clients, run `tailscale serve --bg http://127.0.0.1:3000`, and restrict access with your tailnet policy. Set `BETTER_AUTH_URL` to the HTTPS origin printed by Serve and run `docker compose up -d --wait` again. Do not change the loopback bind for remote access.

Open `/login` at the configured origin and request a code for an allowed address. First sign-in creates an account and a plan. The six-digit code expires after ten minutes and permits three attempts. Addresses outside the list get no email and cannot register or sign in. To change access, edit `.env` and run `docker compose up -d --wait` (a restart alone does not reload configuration). On startup, the app revokes all sessions for addresses no longer allowed, even on devices that were offline. Removing an address also blocks code redemption while it is off the list. Adding it back requires a new sign-in; its budgets stay on disk. An empty list allows nobody and revokes all sessions; Compose requires a nonempty setting.

The database lives at `./data/envelove.db` on the host (`/data/envelove.db` in the container). The container runs as UID/GID 1000; for rootless Docker or user namespaces, grant the corresponding mapped host user write access instead. Never fix permissions by making the directory world-writable. A new directory starts empty; pending Drizzle migrations run before the server listens, on every start. No sample budgets are seeded.

If startup fails, check `docker compose logs --tail=100 app` for migration or permission errors. If no code arrives, check the allowlist spelling, sender verification, Resend delivery events, and spam folder. If the code works but the session does not persist, check that the browser origin matches `BETTER_AUTH_URL`.

## Back up and restore

Make a backup before upgrades and on a schedule. Stop the only writer and archive the **whole data directory**, not just the `.db` file from a running app. Run from the checkout:

```sh
umask 077
mkdir -p backups
archive="backups/envelove-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose stop app && sudo tar -czf - data .env > "$archive" && tar -tzf "$archive" >/dev/null
docker compose start app
```

Only keep the archive if the stop, archive, and listing succeeded. Record `git rev-parse HEAD` alongside it. **It contains financial data, session tokens, the signing secret, and the mail key in plaintext inside gzip.** Encrypt the archive before moving it to separate, access-controlled storage. A backup left only on the same disk cannot protect against disk failure. Monitor backup failures and periodically rehearse a restore.

Restore a trusted backup into a fresh checkout at the recorded revision. For recovery on the same host, stop the container and move the current data and configuration aside first. Do not extract on top of a live or partially migrated database.

```sh
# Existing installation only; use a new destination each time.
docker compose down
saved="data.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$saved"
sudo mv data .env "$saved/"
```

```sh
sudo tar -xzf /path/to/trusted-backup.tar.gz
# Review restored .env: keep the signing secret; confirm today's allowlist,
# private browser origin, and mail settings before accepting connections.
docker compose up -d --build --wait
```

Sign in and compare a known account, transaction, and balance with the backup date. Keep the old copy until that succeeds. If a backup may have leaked, rotate the mail key and signing secret before restarting.

## Upgrade or roll back

1. Make and verify a backup as above, and record the current Git revision. Plan for brief downtime.
2. Fetch the version you want (`git fetch --tags origin`, then `git checkout <tag-or-commit>`). Review configuration changes against `.env.example`; do not replace `.env`.
3. Run `docker compose build --pull` then `docker compose up -d --wait`. The replacement container mounts the same `data/` and runs pending migrations. A migration failure prevents the server from starting.
4. Check `docker compose ps`, sign in, and open a known budget. To roll back, return to the previous revision **and restore its matching pre-upgrade backup**. Do not run an older app against a newer schema. Changes made since the backup will not be present in the restored copy.

## Local development only

Use Node 24 and the pnpm version in `package.json`. Copy `.env.example` to `.env.local`, fill in the secret and allowlist, and use `DATABASE_URL=./local.db`. Run `pnpm install --frozen-lockfile`, `pnpm db:migrate`, then `pnpm dev`. To skip mail in development, set `SEED_EMAIL` to an allowed address; authenticated pages use the development sign-in endpoint, which returns 404 in production. Never expose the development server. In an Amp orb, `.agents/setup` prepares a separate seeded `orb.db`; `amp orb services ensure` starts the development preview.

## License

Envelove is licensed under the [GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`). If you modify Envelove and run it as a service, you must prominently offer everyone who interacts with that version over a network access to its corresponding source code at no charge.
