#!/usr/bin/env bash
# Mise à jour de PartyHub, lancée chaque minute par systemd (partyhub-update.timer).
#
# C’est le seul élément de l’installation qui parle à Docker. L’application écrit une demande dans
# DATA_DIR/update (request.json). Ce script la prend en charge, attend la fin des parties, passe à la
# version demandée, vérifie que le serveur répond dans cette version, et revient à la précédente sinon.
# Voir docs/MISE-A-JOUR.md.
set -euo pipefail

# systemd lit ce fichier pendant qu’il tourne, et le « git checkout » peut le remplacer : on s’exécute
# donc depuis une copie temporaire.
if [[ "${PARTYHUB_UPDATER_COPY:-}" != "1" ]]; then
  PARTYHUB_UPDATER_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  copy="$(mktemp)"
  cp "${BASH_SOURCE[0]}" "$copy"
  PARTYHUB_UPDATER_COPY=1 PARTYHUB_UPDATER_HERE="$PARTYHUB_UPDATER_HERE" PARTYHUB_UPDATER_SELF="$copy" \
    exec bash "$copy" "$@"
fi
trap 'rm -f "${PARTYHUB_UPDATER_SELF:-}"' EXIT
HERE="$PARTYHUB_UPDATER_HERE"
STATE="$HERE/partyhub-update-state.py"

INSTALL_DIR="${PARTYHUB_DIR:-/DATA/AppData/partyhub}"
COMPOSE_FILE="${PARTYHUB_COMPOSE_FILE:-compose.yaml}"
VOLUME="${PARTYHUB_VOLUME:-partyhub-data}"
HEALTH_URL="${PARTYHUB_HEALTH_URL:-https://127.0.0.1/api/health}"
HEALTH_TIMEOUT="${PARTYHUB_HEALTH_TIMEOUT:-240}"
LOCK_FILE="${PARTYHUB_LOCK_FILE:-/run/partyhub-update.lock}"

DATA=""
UPD=""

log() {
  printf '%s %s\n' "$(date '+%F %T')" "$*" >&2
}

# Écrit le résultat de la tentative et libère la demande.
finish() { # état, version demandée, version précédente, message
  python3 -I "$STATE" status "$UPD/status.json" "$1" "$2" "$3" "$4"
  log "$4"
  rm -f "$UPD/request.processing.json"
}

# Attend que le serveur réponde et annonce la version attendue (vide : n’importe laquelle).
wait_for_version() { # version attendue
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    if curl -fsSk -m 5 "$HEALTH_URL" >/dev/null 2>&1 \
      && python3 -I "$STATE" version-live "$UPD/server-heartbeat.json" "$1" 120; then
      return 0
    fi
    sleep 5
  done
  return 1
}

switch_to() { # version demandée
  docker compose -f "$COMPOSE_FILE" up -d || return 1
  wait_for_version "$1"
}

# La nouvelle version n’a pas démarré : retour à la précédente, et à la base d’avant si elle l’a modifiée.
rollback() { # version tentée, version précédente, commit précédent, sauvegarde de la base
  local version="$1" from="$2" previous_sha="$3" backup="$4"
  python3 -I "$STATE" status "$UPD/status.json" running "$version" "$from" \
    "La version $version ne répond pas : retour à la version précédente."
  log "La version $version ne répond pas : retour à la version précédente."
  docker compose -f "$COMPOSE_FILE" stop >/dev/null 2>&1 || true

  # Une sauvegarde de migration créée après la demande prouve que la nouvelle version a modifié la base.
  # L’ancienne version refuserait alors de démarrer : on remet la base d’avant la mise à jour.
  if [[ -n "$(find "$DATA/migrations" -name 'avant-schema-*.db' -newer "$UPD/request.processing.json" 2>/dev/null | head -n 1)" ]]; then
    if [[ -n "$backup" && -f "$DATA/backups/$backup" ]]; then
      cp -p "$DATA/backups/$backup" "$DATA/partyhub.db.restore"
      mv -f "$DATA/partyhub.db.restore" "$DATA/partyhub.db"
      rm -f "$DATA/partyhub.db-wal" "$DATA/partyhub.db-shm"
      log "Base restaurée depuis $backup."
    else
      finish failed "$version" "$from" \
        "La nouvelle version a modifié la base et la sauvegarde est introuvable : restauration manuelle nécessaire (docs/MISE-A-JOUR.md)."
      exit 1
    fi
  fi

  git checkout --quiet --detach "$previous_sha"
  docker compose -f "$COMPOSE_FILE" up -d || true
  if wait_for_version "$from"; then
    finish rolled-back "$version" "$from" \
      "La version $version n’a pas démarré correctement : PartyHub est revenu en version $from."
    exit 1
  fi
  finish failed "$version" "$from" \
    "La version $version a échoué, et le retour à la version $from ne répond pas : vérifiez le serveur."
  exit 1
}

main() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0

  local data
  if ! data="$(docker volume inspect "$VOLUME" --format '{{ .Mountpoint }}' 2>/dev/null)" || [[ -z "$data" ]]; then
    log "Volume Docker « $VOLUME » introuvable : mise à jour impossible."
    exit 1
  fi
  DATA="$data"
  UPD="$DATA/update"
  mkdir -p "$UPD"
  python3 -I "$STATE" seen "$UPD/updater-heartbeat.json"

  if [[ ! -f "$UPD/request.json" ]]; then
    # Une demande prise en charge depuis plus de 45 minutes a été abandonnée par un arrêt brutal.
    if [[ -f "$UPD/request.processing.json" ]] && [[ -n "$(find "$UPD/request.processing.json" -mmin +45)" ]]; then
      finish failed "" "" "Mise à jour interrompue avant la fin. Vérifiez la version affichée."
    fi
    exit 0
  fi

  # Prise en charge : la demande est renommée, et l’application ne peut plus l’annuler.
  mv -f "$UPD/request.json" "$UPD/request.processing.json" 2>/dev/null || exit 0
  local version backup busy
  version="$(python3 -I "$STATE" get "$UPD/request.processing.json" version)"
  backup="$(python3 -I "$STATE" get "$UPD/request.processing.json" backup)"

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    finish failed "$version" "" "Demande refusée : « $version » n’est pas un numéro de version."
    exit 1
  fi

  # Pas de mise à jour pendant une partie : la demande reste en attente, et la prochaine minute réessaie.
  busy="$(python3 -I "$STATE" busy "$UPD/server-heartbeat.json" 120)"
  if [[ "$busy" != "0" ]]; then
    mv -f "$UPD/request.processing.json" "$UPD/request.json"
    python3 -I "$STATE" status "$UPD/status.json" waiting "$version" "" \
      "Une partie est en cours : la mise à jour attendra la fin des parties."
    log "Une partie est en cours : mise à jour vers $version reportée."
    exit 0
  fi

  cd "$INSTALL_DIR" || { finish failed "$version" "" "Dossier d’installation introuvable : $INSTALL_DIR."; exit 1; }
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    finish failed "$version" "" "$INSTALL_DIR n’est pas un dépôt git : mise à jour impossible."
    exit 1
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    finish failed "$version" "" \
      "Des fichiers de $INSTALL_DIR ont été modifiés à la main : mise à jour annulée (voir docs/MISE-A-JOUR.md)."
    exit 1
  fi

  local previous_sha from
  previous_sha="$(git rev-parse HEAD)"
  from="$(git tag --points-at HEAD --list 'v[0-9]*' | head -n 1 || true)"
  from="${from#v}"
  if [[ -z "$from" ]]; then
    from="$(python3 -I "$STATE" get "$UPD/server-heartbeat.json" version)"
  fi

  python3 -I "$STATE" status "$UPD/status.json" running "$version" "$from" \
    "Mise à jour vers la version $version en cours."
  log "Mise à jour vers la version $version (depuis $from)."

  if ! git fetch --tags --force --quiet origin; then
    finish failed "$version" "$from" "Impossible de joindre GitHub : la version $from tourne toujours."
    exit 1
  fi
  if ! git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
    finish failed "$version" "$from" "Le tag v$version n’existe pas dans le dépôt."
    exit 1
  fi
  git checkout --quiet --detach "refs/tags/v$version"

  # Le téléchargement se fait avant d’arrêter le serveur : un échec ne coupe rien.
  if ! docker compose -f "$COMPOSE_FILE" pull --quiet; then
    git checkout --quiet --detach "$previous_sha"
    finish failed "$version" "$from" "Téléchargement de l’image $version impossible : la version $from tourne toujours."
    exit 1
  fi

  if switch_to "$version"; then
    finish done "$version" "$from" "PartyHub est en version $version."
    exit 0
  fi
  rollback "$version" "$from" "$previous_sha" "$backup"
}

main "$@"
