#!/usr/bin/env bash
# Installe la sauvegarde quotidienne de PartyHub sur l’hôte. À lancer une fois, avec sudo, depuis le
# dossier de l’installation : sudo ./deploy/sauvegarde/install.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Lancez ce script avec sudo : sudo ./deploy/sauvegarde/install.sh" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$HERE/../.." && pwd)"

for cmd in docker tar systemctl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Commande introuvable : $cmd. Installez-la, puis relancez ce script." >&2
    exit 1
  fi
done

ENV_FILE=/etc/partyhub-sauvegarde.env
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
# Réglages de la sauvegarde PartyHub. Décommentez et modifiez si besoin.
#PARTYHUB_SAUVEGARDES=/root/partyhub-sauvegardes
#PARTYHUB_SAUVEGARDES_GARDER=14
EOF
  chmod 644 "$ENV_FILE"
  echo "Réglages écrits dans $ENV_FILE."
else
  echo "Réglages existants conservés : $ENV_FILE."
fi

chmod +x "$HERE/partyhub-sauvegarde.sh"
for unit in partyhub-sauvegarde.service partyhub-sauvegarde.timer; do
  sed "s#@INSTALL_DIR@#$INSTALL_DIR#g" "$HERE/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now partyhub-sauvegarde.timer

echo "Sauvegarde installée : tous les jours à 3 h 17."
echo "Lancer une sauvegarde maintenant : sudo systemctl start partyhub-sauvegarde.service"
echo "Voir le résultat : journalctl -u partyhub-sauvegarde.service -n 30"
