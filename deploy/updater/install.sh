#!/usr/bin/env bash
# Installe le service de mise à jour de PartyHub sur l’hôte. À lancer une fois, avec sudo, depuis le
# dossier de l’installation : sudo ./deploy/updater/install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Lancez ce script avec sudo : sudo ./deploy/updater/install.sh" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$HERE/../.." && pwd)"

for cmd in git docker python3 curl flock systemctl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Commande introuvable : $cmd. Installez-la, puis relancez ce script." >&2
    exit 1
  fi
done

if ! git -C "$INSTALL_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "$INSTALL_DIR n’est pas un dépôt git : clonez PartyHub avant d’installer le service." >&2
  exit 1
fi

# Le dépôt appartient souvent à un autre utilisateur que root : git doit l’accepter (une seule fois).
if ! git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$INSTALL_DIR"; then
  git config --system --add safe.directory "$INSTALL_DIR"
fi

ENV_FILE=/etc/partyhub-updater.env
if [[ ! -f "$ENV_FILE" ]]; then
  # Contrôle après mise à jour : l’HTTPS de l’installation, à l’adresse PARTYHUB_HOST du .env (sinon localhost).
  HOST_ADDR="$(sed -n 's/^PARTYHUB_HOST=//p' "$INSTALL_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '\r')"
  HTTPS_PORT="$(sed -n 's/^PARTYHUB_HTTPS_PORT=//p' "$INSTALL_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '\r')"
  HEALTH_HOST="${HOST_ADDR:-127.0.0.1}"
  HEALTH_URL="https://$HEALTH_HOST${HTTPS_PORT:+:$HTTPS_PORT}/api/health"
  sed -e "s#^PARTYHUB_DIR=.*#PARTYHUB_DIR=$INSTALL_DIR#" \
      -e "s#^PARTYHUB_HEALTH_URL=.*#PARTYHUB_HEALTH_URL=$HEALTH_URL#" \
      "$HERE/partyhub-updater.env.example" > "$ENV_FILE"
  chmod 644 "$ENV_FILE"
  echo "Réglages écrits dans $ENV_FILE."
else
  echo "Réglages existants conservés : $ENV_FILE."
fi

for unit in partyhub-update.service partyhub-update.timer; do
  sed "s#@INSTALL_DIR@#$INSTALL_DIR#g" "$HERE/$unit" > "/etc/systemd/system/$unit"
done
chmod +x "$HERE/partyhub-update.sh"
systemctl daemon-reload
systemctl enable --now partyhub-update.timer

echo "Service installé. La mise à jour depuis l’administration est active."
echo "Journal : journalctl -u partyhub-update.service"
