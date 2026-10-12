#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$(readlink -f -- "$0")")"
umask 077
# Keep the shared configurator hardlinked when its SOT is available locally.
sot="../SCRIPTS/safrano9999/config/config.sh"
if [[ -f "$sot" && ! config.sh -ef "$sot" ]]; then ln -f -- "$sot" config.sh; fi
mode=container
args=()
for arg in "$@"; do
  case "$arg" in
    --no-container) mode=baremetal; args+=("$arg") ;;
    --cloudflare) mode=cloudflare; args+=(--no-container) ;;
    --show|--render-container) args+=("$arg") ;;
    --help) echo 'Usage: ./setup.sh [--no-container | --cloudflare] [--show | --render-container]'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
touch config.conf
sed -i '/^DEPLOY_MODE=/d' config.conf
printf 'DEPLOY_MODE=%s\n' "$mode" >> config.conf
export CONFIG_CONTAINER_IMAGE=ghcr.io/safrano9999/duengerrechner:latest
./config.sh "${args[@]}"
if [[ "$mode" == baremetal ]]; then node scripts/render-systemd.mjs; fi
if [[ "$mode" == cloudflare ]]; then node scripts/config-worker.mjs; fi
printf '\nKonfiguration fertig.\n'
case "$mode" in
  container)
    printf 'Erzeugt: docker-compose.yml und duengerrechner.container.\n\n'
    printf 'Docker starten, wenn das Image lokal vorhanden ist:\n'
    printf '  docker compose up -d --no-build --pull never\n\n'
    printf 'Podman-Quadlet verlinken und starten:\n'
    printf '  mkdir -p ~/.config/containers/systemd\n'
    printf '  ln -s %q ~/.config/containers/systemd/duengerrechner.container\n' "$PWD/duengerrechner.container"
    printf '  systemctl --user daemon-reload\n'
    printf '  systemctl --user start duengerrechner.service\n'
    ;;
  baremetal)
    printf 'Erzeugt: duengerrechner.service.\n\n'
    printf 'Nach Installation der Abhängigkeiten verlinken und starten:\n'
    printf '  mkdir -p ~/.config/systemd/user\n'
    printf '  ln -s %q ~/.config/systemd/user/duengerrechner.service\n' "$PWD/duengerrechner.service"
    printf '  systemctl --user daemon-reload\n'
    printf '  systemctl --user enable --now duengerrechner.service\n'
    ;;
  cloudflare)
    printf 'Erzeugt: wrangler.jsonc. Weiter gemäß CLOUDFLARE-WORKER-SKILL.md.\n'
    ;;
esac
