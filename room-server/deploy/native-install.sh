#!/usr/bin/env bash
# Ubuntu 24.04 x86_64 only. Run from a reviewed, complete room-server bundle.
# Usage: sudo bash room-server/deploy/native-install.sh HOSTNAME_OR_PUBLIC_IPV4
set -Eeuo pipefail
umask 027

die() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || die 'Run as root (or sudo).'
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die 'This installer targets Linux x86_64.'
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || die 'This installer targets Ubuntu 24.04.'
[[ $# -eq 1 ]] || die 'Supply exactly one real DNS hostname or public IPv4 address.'
ROOM_DOMAIN=$1
tls_template=native-Caddyfile
if [[ $ROOM_DOMAIN =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    IFS=. read -r ip_a ip_b ip_c ip_d <<< "$ROOM_DOMAIN"
    for octet in "$ip_a" "$ip_b" "$ip_c" "$ip_d"; do
        [[ $octet == 0 || $octet =~ ^[1-9][0-9]*$ ]] || die 'IPv4 octets cannot have leading zeros.'
        ((10#$octet <= 255)) || die 'Invalid IPv4 address.'
    done
    ((ip_a > 0 && ip_a < 224 && ip_a != 10 && ip_a != 127)) || die 'A public IPv4 address is required.'
    [[ $ROOM_DOMAIN != 169.254.* && $ROOM_DOMAIN != 192.168.* && $ROOM_DOMAIN != 192.0.* && $ROOM_DOMAIN != 192.88.99.* && $ROOM_DOMAIN != 198.51.100.* && $ROOM_DOMAIN != 203.0.113.* ]] || die 'A public IPv4 address is required.'
    ! ((ip_a == 100 && ip_b >= 64 && ip_b <= 127)) || die 'Carrier-grade NAT IPv4 is not public.'
    ! ((ip_a == 172 && ip_b >= 16 && ip_b <= 31)) || die 'Private IPv4 is not supported.'
    ! ((ip_a == 198 && (ip_b == 18 || ip_b == 19))) || die 'Benchmark IPv4 is not supported.'
    tls_template=native-Caddyfile-ip
else
    [[ ${#ROOM_DOMAIN} -le 253 && $ROOM_DOMAIN =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'Expected a lowercase DNS hostname or public IPv4, not a URL, port or wildcard.'
    [[ $ROOM_DOMAIN != example.com && $ROOM_DOMAIN != *.example.com ]] || die 'Use the actual service hostname.'
fi

deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
source_dir=$(cd -- "$deploy_dir/.." && pwd -P)
app_root=/opt/empathy-classroom
config_dir=/etc/empathy-classroom
marker="$app_root/.native-managed-v1"
app_unit=/etc/systemd/system/empathy-classroom.service
tls_unit=/etc/systemd/system/empathy-classroom-https.service
app_user=empathy-classroom
tls_user=empathy-caddy
node_version=24.22.2
caddy_version=2.11.8
# Copied from the official Node release page and Caddy GitHub release assets.
node_sha256=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
caddy_sha256=f032f8805e4df2ce5e1a8a624495c91e9ff763d8ff3ceddadd4784a07c472f40
node_name="node-v${node_version}-linux-x64"
caddy_name="caddy_${caddy_version}_linux_amd64.tar.gz"
node_bin="$app_root/runtime/$node_name/bin/node"
caddy_bin="$app_root/runtime/caddy-v$caddy_version/caddy"

for required in core.mjs d1-store.mjs sqlite-store.mjs node-server.mjs schema.sql; do
    [[ -f $source_dir/$required && ! -L $source_dir/$required ]] || die "Bundle file missing or symlinked: $required"
done
for required in "$tls_template" native-relay.service native-https.service; do
    [[ -f $deploy_dir/$required && ! -L $deploy_dir/$required ]] || die "Deployment file missing or symlinked: $required"
done
command -v systemctl >/dev/null || die 'systemd is required.'
command -v ss >/dev/null || die 'ss is required for the conflict check.'
[[ -d /run/systemd/system ]] || die 'systemd is not running.'

if [[ -e $app_root || -L $app_root ]]; then
    [[ -d $app_root && ! -L $app_root && -f $marker && ! -L $marker ]] || die 'Refusing to overwrite an unmanaged /opt/empathy-classroom.'
    [[ $(stat -c %u "$app_root") == 0 && $(stat -c %u "$marker") == 0 ]] || die 'Deployment root and ownership marker must belong to root.'
    [[ $(cat "$marker") == "$ROOM_DOMAIN" ]] || die 'Existing installation uses another hostname; do not overwrite it.'
else
    for reserved in "$config_dir" /var/lib/empathy-classroom /var/lib/empathy-classroom-https "$app_unit" "$tls_unit"; do
        [[ ! -e $reserved && ! -L $reserved ]] || die "Reserved path already exists: $reserved"
    done
    ! getent passwd "$app_user" >/dev/null || die "Reserved account already exists: $app_user"
    ! getent passwd "$tls_user" >/dev/null || die "Reserved account already exists: $tls_user"
    ! getent group "$app_user" >/dev/null || die "Reserved group already exists: $app_user"
    ! getent group "$tls_user" >/dev/null || die "Reserved group already exists: $tls_user"
fi

# Reruns may use only their own service's sockets. Never stop an unrelated owner.
check_port() {
    local port=$1 unit=$2 expected_pid line pid
    expected_pid=$(systemctl show "$unit" --property=MainPID --value 2>/dev/null || true)
    while IFS= read -r line; do
        [[ -z $line ]] && continue
        [[ -f $marker && $expected_pid =~ ^[1-9][0-9]*$ ]] || die "Port $port is occupied; no service was stopped."
        [[ $line == *"pid=$expected_pid,"* ]] || die "Port $port belongs to another service."
        # Detect any additional process sharing the socket as well.
        while IFS= read -r pid; do
            [[ ${pid#pid=} == "$expected_pid" ]] || die "Port $port has an additional owner."
        done < <(grep -oE 'pid=[0-9]+' <<<"$line")
    done < <(ss -H -lntp "sport = :$port")
}
check_port 80 empathy-classroom-https.service
check_port 443 empathy-classroom-https.service
check_port 8787 empathy-classroom.service

printf '%s\n' 'Preflight passed. Existing unrelated services will not be changed.'
if ! command -v curl >/dev/null || ! command -v xz >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends ca-certificates curl xz-utils
fi
stage_dir=$(mktemp -d /var/tmp/empathy-native.XXXXXXXX)
trap 'printf "Installer staging files retained at %s\n" "$stage_dir" >&2' EXIT
fetch() { curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 15 --max-time 240 "$1" -o "$2"; }
if [[ ! -x $node_bin ]]; then
    fetch "https://nodejs.org/dist/v$node_version/$node_name.tar.xz" "$stage_dir/$node_name.tar.xz"
    (cd "$stage_dir"; printf '%s  %s\n' "$node_sha256" "$node_name.tar.xz" | sha256sum --check --strict)
    tar -xJf "$stage_dir/$node_name.tar.xz" -C "$stage_dir"
    [[ $("$stage_dir/$node_name/bin/node" --version) == "v$node_version" ]] || die 'Node version mismatch.'
fi
if [[ ! -x $caddy_bin ]]; then
    fetch "https://github.com/caddyserver/caddy/releases/download/v$caddy_version/$caddy_name" "$stage_dir/$caddy_name"
    (cd "$stage_dir"; printf '%s  %s\n' "$caddy_sha256" "$caddy_name" | sha256sum --check --strict)
    mkdir "$stage_dir/caddy-v$caddy_version"
    tar -xzf "$stage_dir/$caddy_name" -C "$stage_dir/caddy-v$caddy_version" caddy
    [[ $("$stage_dir/caddy-v$caddy_version/caddy" version) == "v$caddy_version "* ]] || die 'Caddy version mismatch.'
fi

install -d -o root -g root -m 0755 "$app_root" "$app_root/runtime" "$app_root/releases" "$config_dir"
if [[ ! -f $marker ]]; then
    printf '%s\n' "$ROOM_DOMAIN" > "$marker"
    chmod 0600 "$marker"
fi
for account in "$app_user" "$tls_user"; do
    if ! getent passwd "$account" >/dev/null; then
        useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$account"
    fi
    [[ $(getent passwd "$account" | cut -d: -f7) == /usr/sbin/nologin ]] || die "Account $account must be a dedicated non-login user."
done
if [[ ! -x $node_bin ]]; then mv "$stage_dir/$node_name" "$app_root/runtime/$node_name"; fi
if [[ ! -x $caddy_bin ]]; then mv "$stage_dir/caddy-v$caddy_version" "$app_root/runtime/caddy-v$caddy_version"; fi
chown -R root:root "$app_root/runtime/$node_name" "$app_root/runtime/caddy-v$caddy_version"
chmod -R go-w "$app_root/runtime/$node_name" "$app_root/runtime/caddy-v$caddy_version"
chmod -R a+rX "$app_root/runtime/$node_name" "$app_root/runtime/caddy-v$caddy_version"

release_id=$(cat "$source_dir/core.mjs" "$source_dir/d1-store.mjs" "$source_dir/sqlite-store.mjs" "$source_dir/node-server.mjs" "$source_dir/schema.sql" | sha256sum | cut -c1-16)
release_dir="$app_root/releases/$release_id"
install -d -o root -g root -m 0755 "$release_dir"
for required in core.mjs d1-store.mjs sqlite-store.mjs node-server.mjs schema.sql; do
    install -o root -g root -m 0644 "$source_dir/$required" "$release_dir/$required"
done
for module in "$release_dir"/*.mjs; do "$node_bin" --check "$module"; done
"$node_bin" --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(":memory:"); db.close();'
ROOM_DOMAIN="$ROOM_DOMAIN" "$caddy_bin" adapt --config "$deploy_dir/$tls_template" --adapter caddyfile >/dev/null

# Preserve managed configuration and previous release for operator rollback.
backup_dir="$app_root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 0700 "$backup_dir"
for original in "$config_dir/room.env" "$config_dir/Caddyfile" "$app_unit" "$tls_unit"; do
    if [[ -f $original ]]; then cp -p "$original" "$backup_dir/$(basename "$original")"; fi
done
previous_release=$(readlink "$app_root/current" || true)
printf '%s\n' "$previous_release" > "$backup_dir/previous-release"
cat > "$config_dir/room.env" <<ENV
NODE_ENV=production
ROOM_HOST=127.0.0.1
PORT=8787
ROOM_DB_PATH=/var/lib/empathy-classroom/classroom.sqlite
ROOM_ALLOWED_ORIGINS=https://bybybye317-source.github.io
ROOM_DOMAIN=$ROOM_DOMAIN
ENV
chmod 0644 "$config_dir/room.env"
install -o root -g root -m 0644 "$deploy_dir/$tls_template" "$config_dir/Caddyfile"
install -o root -g root -m 0644 "$deploy_dir/native-relay.service" "$app_unit"
install -o root -g root -m 0644 "$deploy_dir/native-https.service" "$tls_unit"
ln -s "$release_dir" "$app_root/current.next.$$"
mv -Tf "$app_root/current.next.$$" "$app_root/current"
systemctl daemon-reload
systemctl enable empathy-classroom.service empathy-classroom-https.service
systemctl restart empathy-classroom.service
healthy=0
for attempt in {1..15}; do
    if curl --fail --silent --max-time 3 http://127.0.0.1:8787/api/health > "$stage_dir/health.json"; then healthy=1; break; fi
    sleep 1
done
if [[ $healthy != 1 ]]; then
    if [[ -n $previous_release && -d $previous_release ]]; then
        ln -s "$previous_release" "$app_root/current.rollback.$$"
        mv -Tf "$app_root/current.rollback.$$" "$app_root/current"
        systemctl restart empathy-classroom.service
    fi
    die 'Relay health failed. Check its journal. Previous source release was restored when available.'
fi
"$node_bin" --input-type=module -e 'import fs from "node:fs"; const h=JSON.parse(fs.readFileSync(process.argv[1])); if(h.ok!==true||h.storage!=="sqlite"||h.roomTtlSeconds!==18000)process.exit(1);' "$stage_dir/health.json"
systemctl restart empathy-classroom-https.service
systemctl is-active --quiet empathy-classroom.service
systemctl is-active --quiet empathy-classroom-https.service
printf '%s\n' "Relay and HTTPS services started. Verify public TLS separately: https://$ROOM_DOMAIN/api/health"
printf '%s\n' 'The firewall and DNS were not modified. Expose only TCP 80/443; keep 8787 private.'
printf '%s\n' "Managed config backup: $backup_dir (no participant photos are copied)."
