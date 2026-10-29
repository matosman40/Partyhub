#!/usr/bin/env bash
# Tests du script de mise à jour, sans Docker ni réseau. git, docker, curl et sleep sont remplacés par
# de faux programmes qui notent leurs appels. Lancer : bash deploy/updater/test/partyhub-update.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$HERE/partyhub-update.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/bin"

cat > "$ROOT/bin/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >> "$CALLS"
case "$*" in
  "rev-parse --is-inside-work-tree") echo true ;;
  "diff --quiet"|"diff --cached --quiet") exit "${FAKE_DIRTY:-0}" ;;
  "rev-parse HEAD") echo "prevsha" ;;
  "tag --points-at HEAD"*) echo "v${FAKE_FROM:-0.12.0}" ;;
  fetch*) exit "${FAKE_FETCH:-0}" ;;
  "rev-parse -q --verify refs/tags/v"*) [[ "${FAKE_TAG_OK:-1}" == 1 ]] || exit 1; echo sha ;;
esac
exit 0
STUB

cat > "$ROOT/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
if [[ "$1" == volume ]]; then echo "$FAKE_DATA"; exit 0; fi
case "$*" in
  *" pull"*) exit "${FAKE_PULL:-0}" ;;
esac
exit 0
STUB

cat > "$ROOT/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
exit "${FAKE_HEALTH:-0}"
STUB

printf '#!/usr/bin/env bash\nexit 0\n' > "$ROOT/bin/sleep"
chmod +x "$ROOT/bin/"*

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL $1"; }
check() { # nom, commande : réussit si la commande réussit
  local name="$1"
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}

now_iso() { date -u '+%Y-%m-%dT%H:%M:%S.000Z'; }

new_case() {
  CASE="$(mktemp -d "$ROOT/case.XXXXXX")"
  DATA="$CASE/data"
  mkdir -p "$DATA/update" "$DATA/migrations" "$DATA/backups" "$CASE/install"
  touch "$CASE/install/compose.yaml" "$CASE/calls.log"
}

write_request() { # version, sauvegarde
  printf '{"version":"%s","requestedAt":"%s","backup":"%s"}\n' "$1" "$(now_iso)" "${2:-}" > "$DATA/update/request.json"
}

write_heartbeat() { # version du serveur, parties en cours
  printf '{"version":"%s","inGame":%s,"updatedAt":"%s"}\n' "$1" "$2" "$(now_iso)" > "$DATA/update/server-heartbeat.json"
}

run() { # variables FAKE_* éventuelles, en arguments
  set +e
  env PATH="$ROOT/bin:$PATH" CALLS="$CASE/calls.log" FAKE_DATA="$DATA" \
    PARTYHUB_DIR="$CASE/install" PARTYHUB_LOCK_FILE="$CASE/lock" PARTYHUB_HEALTH_TIMEOUT=2 \
    "$@" bash "$SCRIPT" > "$CASE/out.log" 2>&1
  RC=$?
  set -e
}

state() {
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["state"])' "$DATA/update/status.json" 2>/dev/null || echo none
}
state_is() { [[ "$(state)" == "$1" ]]; }
calls_has() { grep -q -F -- "$1" "$CASE/calls.log"; }
calls_lacks() { ! grep -q -F -- "$1" "$CASE/calls.log"; }
calls_count() { grep -c -F -- "$1" "$CASE/calls.log" || true; }
count_is() { [[ "$(calls_count "$1")" == "$2" ]]; }
absent() { [[ ! -e "$1" ]]; }
same_file() { cmp -s "$1" "$2"; }
exit_is() { [[ "$RC" == "$1" ]]; }

echo "— Pas de demande"
new_case
run
check "sans demande : sortie propre" exit_is 0
check "sans demande : présence de l’installeur signalée" test -f "$DATA/update/updater-heartbeat.json"
check "sans demande : aucune commande de mise à jour" calls_lacks "compose"

echo "— Partie en cours"
new_case
write_request 0.13.0
write_heartbeat 0.12.0 1
run
check "partie en cours : la demande reste en attente" test -f "$DATA/update/request.json"
check "partie en cours : le statut dit d’attendre" state_is waiting
check "partie en cours : aucune commande de mise à jour" calls_lacks "compose"
check "partie en cours : sortie propre" exit_is 0

echo "— Version invalide"
new_case
write_request "1.2"
write_heartbeat 0.12.0 0
run
check "version invalide : statut échec" state_is failed
check "version invalide : demande retirée" absent "$DATA/update/request.processing.json"
check "version invalide : aucune commande de mise à jour" calls_lacks "compose"
check "version invalide : code d’erreur" exit_is 1

echo "— Nom de sauvegarde avec chemin"
new_case
write_request 0.13.0 "../../etc/passwd.db"
write_heartbeat 0.12.0 0
run
check "sauvegarde invalide : statut échec" state_is failed
check "sauvegarde invalide : demande retirée" absent "$DATA/update/request.processing.json"
check "sauvegarde invalide : aucune commande de mise à jour" calls_lacks "compose"
check "sauvegarde invalide : code d’erreur" exit_is 1

echo "— Dépôt modifié à la main"
new_case
write_request 0.13.0
write_heartbeat 0.12.0 0
run FAKE_DIRTY=1
check "dépôt modifié : statut échec" state_is failed
check "dépôt modifié : aucune commande de mise à jour" calls_lacks "compose"

echo "— Mise à jour réussie"
new_case
write_request 0.13.0 b.db
write_heartbeat 0.13.0 0
run FAKE_TAG_OK=1
check "succès : statut fait" state_is done
check "succès : bascule sur le tag v0.13.0" calls_has "checkout --quiet --detach refs/tags/v0.13.0"
check "succès : démarrage une seule fois" count_is "up -d" 1
check "succès : demande retirée" absent "$DATA/update/request.processing.json"
check "succès : sortie propre" exit_is 0

echo "— Échec avec migration : retour arrière et base restaurée"
new_case
printf 'avant' > "$DATA/backups/b.db"
printf 'nouvelle' > "$DATA/partyhub.db"
write_request 0.13.0 b.db
write_heartbeat 0.12.0 0
printf 'x' > "$DATA/migrations/avant-schema-13-test.db"
touch -d '+1 hour' "$DATA/migrations/avant-schema-13-test.db"
run
check "migration : statut revenu en arrière" state_is rolled-back
check "migration : base restaurée depuis la sauvegarde" same_file "$DATA/partyhub.db" "$DATA/backups/b.db"
check "migration : retour au commit précédent" calls_has "checkout --quiet --detach prevsha"
check "migration : serveur arrêté avant la restauration" calls_has "compose -f compose.yaml stop"
check "migration : redémarrage en version précédente" count_is "up -d" 2
check "migration : code d’erreur" exit_is 1

echo "— Échec sans migration : la base n’est pas touchée"
new_case
printf 'avant' > "$DATA/backups/b.db"
printf 'nouvelle' > "$DATA/partyhub.db"
write_request 0.13.0 b.db
write_heartbeat 0.12.0 0
run
check "sans migration : statut revenu en arrière" state_is rolled-back
check "sans migration : base inchangée" grep -qx nouvelle "$DATA/partyhub.db"
check "sans migration : aucune restauration tentée" absent "$DATA/partyhub.db.restore"

echo "— Téléchargement impossible"
new_case
write_request 0.13.0 b.db
write_heartbeat 0.12.0 0
run FAKE_PULL=1
check "téléchargement : statut échec" state_is failed
check "téléchargement : retour au commit précédent" calls_has "checkout --quiet --detach prevsha"
check "téléchargement : serveur non redémarré" calls_lacks "up -d"

echo "— Demande abandonnée par un arrêt brutal"
new_case
printf '{"version":"0.13.0"}\n' > "$DATA/update/request.processing.json"
touch -d '2 hours ago' "$DATA/update/request.processing.json"
run
check "demande périmée : statut échec" state_is failed
check "demande périmée : fichier de travail retiré" absent "$DATA/update/request.processing.json"
check "demande périmée : sortie propre" exit_is 0

echo
echo "$PASS réussis, $FAIL échoué(s)"
[[ "$FAIL" -eq 0 ]]
