#!/bin/sh
# Installation de PartyHub sur cette machine, directement en HTTPS sur le réseau local.
#
# Usage, depuis le dossier de PartyHub (où se trouve compose.yaml) :
#   sh install.sh                  l'adresse du serveur est détectée automatiquement
#   sh install.sh 192.168.1.156    ou donnée explicitement
#
# Relancer le script est sûr : il garde les réglages déjà présents dans .env.
# Ordre de l'adresse : argument, puis PARTYHUB_HOST de .env, puis détection automatique.
# Ensuite, tout se règle dans l'administration (Système → Réglages du serveur).

set -eu

die() {
  echo "Erreur : $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "Docker n'est pas installé (https://docs.docker.com/engine/install/)."
docker compose version >/dev/null 2>&1 || die "Docker Compose est requis (commande « docker compose »)."
[ -f compose.yaml ] || die "Lancez ce script depuis le dossier de PartyHub (où se trouve compose.yaml)."

detect_address() {
  # Adresse de l'interface qui sort sur le réseau : évite les adresses internes de Docker (172.17.x.x…).
  if command -v ip >/dev/null 2>&1; then
    ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
  fi
}

detect_fallback() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || true
  fi
}

addr="${1:-}"
# Relance : l'adresse déjà présente dans .env passe avant la détection automatique.
if [ -z "$addr" ] && [ -f .env ]; then
  addr="$(sed -n 's/^PARTYHUB_HOST=//p' .env | tail -n 1 | tr -d '\r')"
fi
[ -n "$addr" ] || addr="$(detect_address || true)"
[ -n "$addr" ] || addr="$(detect_fallback || true)"
[ -n "$addr" ] || die "Adresse du serveur introuvable. Relancez avec elle : sh install.sh 192.168.1.156"
case "$addr" in
  *[!0-9A-Za-z.-]*) die "Adresse invalide : $addr" ;;
esac

[ -f .env ] || cp .env.example .env

# Adresse du serveur dans .env : remplace la ligne (commentée ou non), ou l'ajoute.
if grep -q '^#* *PARTYHUB_HOST=' .env; then
  sed "s/^#* *PARTYHUB_HOST=.*/PARTYHUB_HOST=$addr/" .env > .env.tmp && mv .env.tmp .env
else
  printf '\nPARTYHUB_HOST=%s\n' "$addr" >> .env
fi
# .env peut contenir des clés et le mot de passe administrateur : lisible par le propriétaire et son groupe seulement.
chmod 640 .env 2>/dev/null || true

echo "Démarrage de PartyHub en HTTPS à l'adresse $addr…"
docker compose up -d

if ! command -v curl >/dev/null 2>&1; then
  echo "curl est absent : vérifiez ensuite https://$addr dans votre navigateur."
  exit 0
fi

tries=0
until curl -fsSk --max-time 3 "https://$addr/api/health" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    die "PartyHub ne répond pas encore. Regardez les journaux : docker compose logs --tail 50"
  fi
  sleep 2
done

cat <<MSG

PartyHub est installé.

  Ouvrez https://$addr sur vos appareils.
  Le certificat est interne : installez d'abord le certificat racine, téléchargeable sur
  https://$addr/certificat (voir docs/HTTPS-LAN.md pour chaque appareil).

  Mot de passe administrateur : si ADMIN_PASSWORD n'était pas défini dans .env, il est écrit une seule fois
  dans le volume de données. Lisez-le puis supprimez le fichier :
    docker compose exec partyhub cat /data/admin-password.txt
    docker compose exec partyhub rm /data/admin-password.txt

MSG
