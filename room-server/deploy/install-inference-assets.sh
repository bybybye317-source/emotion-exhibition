#!/usr/bin/env bash
# Add bounded public model downloads to an existing native classroom deployment.
# Usage: sudo bash room-server/deploy/install-inference-assets.sh
set -Eeuo pipefail
umask 027
die() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[[ ${EUID} -eq 0 && $# -eq 0 ]] || die 'Run as root without arguments.'
app_root=/opt/empathy-classroom
config_dir=/etc/empathy-classroom
caddy_bin="$app_root/runtime/caddy-v2.11.8/caddy"
unit=empathy-classroom-https.service
commit=a5bb02414db1060733c64236970802b687fd881b
release="$app_root/inference-assets/$commit"
[[ -f $app_root/.native-managed-v1 && ! -L $app_root/.native-managed-v1 ]] || die 'An existing native-managed installation is required.'
[[ -f $config_dir/room.env && -f $config_dir/Caddyfile && ! -L $config_dir/Caddyfile && -x $caddy_bin ]] || die 'Native runtime/configuration is missing or unsafe.'
[[ $(stat -c %u "$app_root/.native-managed-v1") == 0 ]] || die 'The native marker must belong to root.'
source "$config_dir/room.env"
[[ $ROOM_DOMAIN == "$(cat "$app_root/.native-managed-v1")" ]] || die 'The deployment hostname differs from its ownership marker.'
systemctl is-active --quiet "$unit" || die 'The existing HTTPS service must already be active.'
stage=$(mktemp -d /var/tmp/empathy-inference.XXXXXXXX)
chmod 0755 "$stage"
trap 'printf "Inference staging retained: %s\n" "$stage" >&2' EXIT
cat > "$stage/manifest" <<'MANIFEST'
8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8 mediapipe/LICENSE static/vendor/mediapipe/LICENSE
746b09f9113ca75b32be592bd112a74cbbde66009582b29652cb3e99e582e6d0 mediapipe/package-source.json static/vendor/mediapipe/package-source.json
40f4123dfcd75cfa58add046919cc6f52fde66f009ff582997c09ba54c6ba27c mediapipe/vision_bundle.mjs static/vendor/mediapipe/vision_bundle.mjs
4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb mediapipe/wasm/vision_wasm_internal.js static/vendor/mediapipe/wasm/vision_wasm_internal.js
f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7 mediapipe/wasm/vision_wasm_internal.wasm static/vendor/mediapipe/wasm/vision_wasm_internal.wasm
927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f mediapipe/wasm/vision_wasm_nosimd_internal.js static/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js
3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4 mediapipe/wasm/vision_wasm_nosimd_internal.wasm static/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm
2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c ort/LICENSE static/vendor/ort/LICENSE
e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc ort/ThirdPartyNotices.txt static/vendor/ort/ThirdPartyNotices.txt
30dd851d9c00622940500f71ddd2ff8820c5cb65270816080175b958705385a8 ort/ort-wasm-simd-threaded.mjs static/vendor/ort/ort-wasm-simd-threaded.mjs
71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4 ort/ort-wasm-simd-threaded.wasm static/vendor/ort/ort-wasm-simd-threaded.wasm
6ef726f355b791129f7ddf3f62e7877a16b9b777abe87004b8ab306e6b9cf265 ort/ort.wasm.min.mjs static/vendor/ort/ort.wasm.min.mjs
ea9f052ef5e492c11c9ce07c947a1ac277a67a8a106b74668171e2042178c151 ort/package-source.json static/vendor/ort/package-source.json
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff face_landmarker.task static/inference-models/face_landmarker.task
8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8 LICENSE-MEDIAPIPE static/inference-models/LICENSE-MEDIAPIPE
c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4 LICENSE-EMOTIEFFLIB-CODE static/inference-models/LICENSE-EMOTIEFFLIB-CODE
a4b7021a72968c36a8782be134f951447dc8ac1247bc801ffcb98dafe444f821 SOURCES.md static/inference-models/SOURCES.md
526eb1dc56aa785340367391619f40daa7c72dd7a8496301969fdb6a96b84108 asset-integrity.json static/inference-models/asset-integrity.json
MANIFEST
fetch() { curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 15 --max-time 180 "$1" -o "$2"; }
if [[ -e $release ]]; then
    [[ -d $release && ! -L $release ]] || die 'Existing asset release is not a regular directory.'
    while read -r checksum target source; do
        [[ -f $release/$target && ! -L $release/$target ]] || die "Missing or symlinked asset: $target"
        printf '%s  %s\n' "$checksum" "$release/$target" | sha256sum --check --strict --status || die "Asset checksum mismatch: $target"
    done < "$stage/manifest"
else
    mkdir "$stage/assets"
    while read -r checksum target source; do
        mkdir -p "$stage/assets/$(dirname "$target")"
        fetch "https://raw.githubusercontent.com/bybybye317-source/emotion-exhibition/$commit/$source" "$stage/assets/$target"
        printf '%s  %s\n' "$checksum" "$stage/assets/$target" | sha256sum --check --strict --status || die "Downloaded checksum mismatch: $target"
    done < "$stage/manifest"
    chmod -R a+rX "$stage/assets"
    install -d -o root -g root -m 0755 "$app_root/inference-assets"
    mv "$stage/assets" "$release"
fi
# The classifier is deliberately not copied into this release. Its one fixed
# upstream URL is streamed through Caddy without a disk cache or photo upload.
cat > "$stage/inference-assets.caddy" <<CADDY
@inference_assets path /inference-assets/*
handle @inference_assets {
    route {
        # Compress WASM/JavaScript on the wire; browsers verify decoded bytes.
        encode zstd gzip
        header {
            Access-Control-Allow-Origin https://bybybye317-source.github.io
            Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
            Access-Control-Expose-Headers "Content-Length, Content-Type"
            Cross-Origin-Resource-Policy cross-origin
            X-Content-Type-Options nosniff
        }
        @inference_preflight method OPTIONS
        respond @inference_preflight "" 204
        @inference_write not method GET HEAD
        respond @inference_write "Read-only assets" 405
        @inference_classifier path /inference-assets/classifier.onnx
        handle @inference_classifier {
            # This rewrite replaces the entire client URI, including its query.
            rewrite * /sb-ai-lab/EmotiEffLib/520a051c64cd191521e5934655314e769a319684/models/affectnet_emotions/onnx/enet_b0_8_best_afew.onnx?
            reverse_proxy https://raw.githubusercontent.com {
                header_up -*
                header_up Host raw.githubusercontent.com
                header_up Accept-Encoding identity
                header_down -Set-Cookie
                header_down Access-Control-Allow-Origin https://bybybye317-source.github.io
                header_down Cache-Control "no-store"
                header_down Content-Type application/octet-stream
                flush_interval -1
                transport http {
                    dial_timeout 10s
                    response_header_timeout 20s
                }
            }
        }
CADDY
printf '        @inference_public path' >> "$stage/inference-assets.caddy"
while read -r checksum target source; do printf ' /inference-assets/%s' "$target" >> "$stage/inference-assets.caddy"; done < "$stage/manifest"
cat >> "$stage/inference-assets.caddy" <<CADDY

        handle @inference_public {
            uri strip_prefix /inference-assets
            root * $release
            header Cache-Control "public, max-age=31536000, immutable"
            file_server
        }
        handle {
            respond "Unknown inference asset" 404
        }
    }
}
CADDY
[[ ! -L $config_dir/conf.d && ! -L $config_dir/conf.d/inference-assets.caddy ]] || die 'Refusing symlinked configuration paths.'
# Caddy reloads as empathy-caddy, not root. A 0750 root:root directory makes
# the optional glob silently empty for that user even when root validates it.
install -d -o root -g root -m 0755 "$config_dir/conf.d"
# Import only the managed snippet directory. Empty globs are supported by Caddy.
import_line='    import /etc/empathy-classroom/conf.d/*.caddy'
import_pattern='^[[:space:]]*import[[:space:]]+/etc/empathy-classroom/conf[.]d/[*][.]caddy[[:space:]]*$'
api_pattern='^[[:space:]]*@room_api[[:space:]]+path[[:space:]]+/api/[*][[:space:]]*$'
if grep -Eq "$import_pattern" "$config_dir/Caddyfile"; then
    cp "$config_dir/Caddyfile" "$stage/Caddyfile"
else
    [[ $(grep -Ec "$api_pattern" "$config_dir/Caddyfile") == 1 ]] || die 'The expected API stanza was not found exactly once.'
    awk -v insert="$import_line" -v pattern="$api_pattern" '{if ($0 ~ pattern) print insert; print}' "$config_dir/Caddyfile" > "$stage/Caddyfile"
fi
[[ $(grep -Ec "$import_pattern" "$stage/Caddyfile") == 1 ]] || die 'The inference import was not inserted exactly once.'
# Validate a candidate against the new snippet before touching the live config.
# Other conf.d snippets are preserved and validated together after installation.
awk -v file="$stage/inference-assets.caddy" -v pattern="$import_pattern" '{if($0 ~ pattern) print "    import " file; else print}' "$stage/Caddyfile" > "$stage/validate.Caddyfile"
ROOM_DOMAIN="$ROOM_DOMAIN" "$caddy_bin" validate --config "$stage/validate.Caddyfile" --adapter caddyfile >/dev/null
backup="$app_root/backups/inference-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 0700 "$backup"
cp -p "$config_dir/Caddyfile" "$backup/Caddyfile"
prior_snippet=0
if [[ -f $config_dir/conf.d/inference-assets.caddy ]]; then cp -p "$config_dir/conf.d/inference-assets.caddy" "$backup/inference-assets.caddy"; prior_snippet=1; fi
rollback() {
    trap - ERR
    cp -p "$backup/Caddyfile" "$config_dir/Caddyfile"
    if [[ $prior_snippet == 1 ]]; then cp -p "$backup/inference-assets.caddy" "$config_dir/conf.d/inference-assets.caddy"; else rm -f "$config_dir/conf.d/inference-assets.caddy"; fi
    systemctl reload "$unit" || true
    printf 'Inference config rolled back. Backup: %s\n' "$backup" >&2
    exit 1
}
trap rollback ERR
install -o root -g root -m 0644 "$stage/inference-assets.caddy" "$config_dir/conf.d/inference-assets.caddy.next"
mv -f "$config_dir/conf.d/inference-assets.caddy.next" "$config_dir/conf.d/inference-assets.caddy"
install -o root -g root -m 0644 "$stage/Caddyfile" "$config_dir/Caddyfile.next"
mv -f "$config_dir/Caddyfile.next" "$config_dir/Caddyfile"
ROOM_DOMAIN="$ROOM_DOMAIN" "$caddy_bin" validate --config "$config_dir/Caddyfile" --adapter caddyfile >/dev/null
runuser -u empathy-caddy -- test -x "$config_dir/conf.d"
runuser -u empathy-caddy -- test -r "$config_dir/conf.d/inference-assets.caddy"
runuser -u empathy-caddy -- env ROOM_DOMAIN="$ROOM_DOMAIN" "$caddy_bin" adapt --config "$config_dir/Caddyfile" --adapter caddyfile > "$stage/service-user-config.json"
grep -Fq "\"$release\"" "$stage/service-user-config.json"
systemctl reload "$unit"
systemctl is-active --quiet "$unit"
curl --fail --silent --show-error --max-time 10 --resolve "$ROOM_DOMAIN:443:127.0.0.1" "https://$ROOM_DOMAIN/api/health"
printf '\n'
# HTTP 200 alone is insufficient: the site's generic fallback also returns 200.
curl --fail --silent --show-error --max-time 30 --resolve "$ROOM_DOMAIN:443:127.0.0.1" "https://$ROOM_DOMAIN/inference-assets/face_landmarker.task" -o "$stage/served-face.task"
[[ $(stat -c %s "$stage/served-face.task") == 3758596 ]]
printf '%s  %s\n' 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff "$stage/served-face.task" | sha256sum --check --strict
trap - ERR
printf 'Inference assets enabled; API process and room database untouched. Backup: %s\n' "$backup"
printf '%s\n' 'Classifier is a fixed, no-store upstream relay. No classifier weights were saved.'
