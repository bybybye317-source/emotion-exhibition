# Native Linux deployment (without Docker)

Deployed on an independent **Ubuntu 24.04 x86_64** Lighthouse instance on 2026-11-04 at `https://43.161.198.80`. Public HTTPS, SQLite health, authenticated photo synchronization, idempotency and actual service-restart persistence passed. Phone Safari on the classroom network still requires a real-device check. This option runs the same Node + SQLite relay with two dedicated systemd services. The installer does not replace global Node, install Docker, edit another web server, open firewall ports, or change DNS.

## Prerequisites and command

Upload the complete `room-server/` directory, including `deploy/native-*`. Review the target machine first. TCP **80 and 443 must be available and reachable from the internet**. Port **8787 stays bound to localhost**; Caddy's admin API uses a private Unix socket rather than TCP 2019.

For a DNS hostname that points directly to the instance:

```sh
sudo bash room-server/deploy/native-install.sh classroom.your-real-domain.tld
```

For the instance's actual public IPv4 address (no domain purchase required):

```sh
sudo bash room-server/deploy/native-install.sh 43.161.198.80
```

The IPv4 template explicitly selects the **Let's Encrypt production ACME issuer and `shortlived` certificate profile**, using HTTP-01 validation on TCP 80. Certificate issuance can therefore proceed before TCP 443 is opened, but public HTTPS verification and use still require 443. It does not use a self-signed certificate or public wildcard DNS service. Caddy renews the roughly six-day certificate automatically; the service and TCP 80 must remain available. `default_sni` selects the public-IP certificate for clients that send no SNI while the instance's local network address is private.

Give Tencent TAT an execution timeout of at least **600 seconds**, since official binary downloads may take time. No package manager upgrade is performed. If curl/xz are missing, only their Ubuntu packages and CA certificates are installed.

## Layout

| Location | Purpose |
|---|---|
| `/opt/empathy-classroom/runtime/` | Root-owned, pinned Node and Caddy binaries |
| `/opt/empathy-classroom/releases/` | Root-owned source releases identified by content hash |
| `/opt/empathy-classroom/current` | Active source release symlink |
| `/etc/empathy-classroom/room.env` | Non-secret service configuration; explicit GitHub Pages CORS origin |
| `/etc/empathy-classroom/Caddyfile` | HTTPS reverse proxy configuration |
| `/var/lib/empathy-classroom/` | SQLite database; only the relay service user can access it |
| `/var/lib/empathy-classroom-https/` | Certificate and ACME state; separate TLS service user |
| `/run/empathy-classroom-https/admin.sock` | Local private Caddy administration socket |

`empathy-classroom.service` runs as the `empathy-classroom` non-login account. `empathy-classroom-https.service` runs as `empathy-caddy`, with only the capability needed to bind low ports. Filesystem writes are confined to each service's state directory and temporary directory. Public access logs are off so room credentials and photos are not copied into request logs.

The installer aborts before downloads or service changes if another process owns 80, 443 or 8787, or reserved paths/accounts already exist without the installer ownership marker. Rerunning the installer for the same hostname/IP may restart only its own services. It preserves SQLite and certificate state, keeps prior source releases, and stores old managed configuration under `/opt/empathy-classroom/backups/`. It never deletes participant data or backs photos up to a third party.

## Verification after deployment

```sh
systemctl is-active empathy-classroom empathy-classroom-https
curl --fail http://127.0.0.1:8787/api/health
curl --fail https://43.161.198.80/api/health
journalctl -u empathy-classroom -u empathy-classroom-https -n 50 --no-pager
```

Both health responses must contain `ok: true`, `storage: "sqlite"`, and `roomTtlSeconds: 18000`. The installer validates local health only; a running Caddy service **does not establish** that a public certificate has already been issued. Verify public HTTPS without `-k`, then create/join a test room and verify photo/contribution synchronization before switching the published frontend. Check Safari on the actual classroom network separately.

The IPv4 endpoint remains stable while that public IP is assigned to this instance. If the instance is replaced or its IP changes, update the Caddy site address and frontend API endpoint deliberately; do not silently reuse old room credentials across origins. A domain can be added later once ownership and DNS access are available.

## Pinned downloads and sources

Verified 2026-11-04:

- [Node v24.22.2 official release and SHA256](https://nodejs.org/en/blog/release/v24.22.2), Linux x64 archive: `48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`.
- [Caddy v2.11.8 official release assets](https://github.com/caddyserver/caddy/releases/expanded_assets/v2.11.8), Linux amd64 archive: `f032f8805e4df2ce5e1a8a624495c91e9ff763d8ff3ceddadd4784a07c472f40`.
- [Caddy TLS issuer/profile syntax](https://caddyserver.com/docs/caddyfile/directives/tls), [private admin socket](https://caddyserver.com/docs/caddyfile/options#admin), and [automatic certificate management](https://caddyserver.com/docs/automatic-https).
- [Let's Encrypt short-lived and IP certificate availability](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).
- [Caddy IP certificate support and fixes](https://github.com/caddyserver/caddy/issues/7399).

Local verification covers shell syntax, target-address validation and 13 actual HTTP/SQLite tests, including CLI startup through the release-directory symlink. Target-instance checks verified both systemd services, official binary checksums, a publicly trusted Let's Encrypt certificate for the IP address, authenticated photo and score synchronization, and persistence after restarting both services. Future deployments must repeat the public HTTPS checks; successful startup alone is insufficient.

## Optional inference download route

`sudo bash room-server/deploy/install-inference-assets.sh` adds a read-only `/inference-assets/` route to the same HTTPS listener. It downloads the pinned public MediaPipe/ONNX runtime files and MediaPipe face task, verifies their SHA-256 checksums, and preserves licenses and source metadata. The fixed emotion-classifier URL is streamed from the original author through a no-store proxy; classifier weights are not packaged in the repository or saved on the server. Client photographs and room tokens do not enter these routes.

Only named assets and GET/HEAD/OPTIONS are accepted. CORS names the existing GitHub Pages origin. The installer backs up Caddy configuration, validates before reload, and rolls back if reload or local HTTPS health fails. It does not restart Node, alter SQLite, change TLS/ACME setup, open ports, or add paid resources. The native templates retain the optional `conf.d/*.caddy` import on future installs. After deployment, verify the public asset response headers, checksum, and successful browser initialization; this script cannot verify iPhone Safari by itself.
