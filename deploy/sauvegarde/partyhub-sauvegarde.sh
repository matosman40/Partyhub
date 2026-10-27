#!/usr/bin/env bash
# Sauvegarde PartyHub : les données (partyhub-data) et l’autorité du certificat HTTPS (partyhub-caddy-data).
# Chaque sauvegarde est une archive datée. Seules les N plus récentes de chaque volume sont gardées.
#
# Le conteneur partyhub est arrêté le temps de la copie : la base SQLite ne peut pas changer pendant
# la lecture, sinon la sauvegarde pourrait être incohérente. L’arrêt dure quelques secondes ; le conteneur
# est redémarré à la fin, même si la sauvegarde échoue.
#
# Réglages (facultatifs, dans /etc/partyhub-sauvegarde.env) :
#   PARTYHUB_SAUVEGARDES         dossier de destination (défaut : /root/partyhub-sauvegardes)
#   PARTYHUB_SAUVEGARDES_GARDER  nombre de sauvegardes gardées par volume (défaut : 14)
set -euo pipefail

DEST="${PARTYHUB_SAUVEGARDES:-/root/partyhub-sauvegardes}"
GARDER="${PARTYHUB_SAUVEGARDES_GARDER:-14}"
CONTENEUR=partyhub
VOLUMES=(partyhub-data partyhub-caddy-data)

if ! [[ "$GARDER" =~ ^[0-9]+$ ]] || [ "$GARDER" -lt 1 ]; then
  echo "PARTYHUB_SAUVEGARDES_GARDER doit être un entier au moins égal à 1." >&2
  exit 1
fi

for vol in "${VOLUMES[@]}"; do
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "Volume introuvable : $vol. PartyHub n’est peut-être pas installé sur cette machine." >&2
    exit 1
  fi
done

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"

ARRETE=0
if docker ps --format '{{.Names}}' | grep -qx "$CONTENEUR"; then
  docker stop "$CONTENEUR" >/dev/null
  ARRETE=1
fi
redemarre() {
  if [ "$ARRETE" = 1 ]; then docker start "$CONTENEUR" >/dev/null || echo "Redémarrez le conteneur $CONTENEUR à la main." >&2; fi
}
trap redemarre EXIT

for vol in "${VOLUMES[@]}"; do
  NOM="$vol-$STAMP.tar.gz"
  # Le volume est monté en lecture seule : la sauvegarde ne modifie jamais les données.
  docker run --rm -v "$vol:/source:ro" -v "$DEST:/sauvegarde" alpine:3.20 \
    sh -c "tar czf /sauvegarde/$NOM -C /source ."
  # Une archive illisible ne doit pas passer pour une sauvegarde valable.
  tar tzf "$DEST/$NOM" >/dev/null
  echo "Sauvegardé : $DEST/$NOM"
  # Rotation : seules les GARDER plus récentes de ce volume restent. Le motif inclut le nom complet du volume.
  ls -1t "$DEST"/"$vol"-[0-9]*.tar.gz 2>/dev/null | tail -n +"$((GARDER + 1))" | xargs -r rm -f --
done

redemarre
trap - EXIT
echo "Sauvegarde terminée. Conteneur $CONTENEUR $( [ "$ARRETE" = 1 ] && echo redémarré || echo non arrêté)."
