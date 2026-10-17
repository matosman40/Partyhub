#!/usr/bin/env bash
# Vérifie une installation PartyHub en HTTPS (fichier deploy/casaos/compose.https.yaml).
#
# Usage, sur le serveur (avec sudo pour voir les conteneurs) :
#   sudo bash scripts/casaos-check.sh [adresse-du-serveur]
# Sans adresse, la première adresse IPv4 de la machine est utilisée.
#
# Ne modifie rien : lit l'état des conteneurs, la réponse HTTPS et le certificat. Chaque contrôle affiche
# OK, ECHEC ou SKIP ; le script sort avec le code 1 si un contrôle échoue.
set -u

HOST="${1:-}"
if [ -z "$HOST" ]; then
  HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$HOST" ]; then
  echo "Adresse du serveur introuvable : passez-la en argument." >&2
  exit 2
fi

BASE="https://$HOST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0

pass() { echo "OK     $*"; }
fail() { echo "ECHEC  $*"; FAILED=$((FAILED + 1)); }
skip() { echo "SKIP   $*"; }
info() { echo "INFO   $*"; }

echo "Vérification de PartyHub sur $BASE"
echo

# 1. Conteneurs (seulement si Docker est accessible : sudo en général).
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  for name in partyhub partyhub-caddy; do
    state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || echo absent)"
    if [ "$state" = "running" ]; then pass "conteneur $name en marche"; else fail "conteneur $name : $state"; fi
  done
  health="$(docker inspect --format '{{.State.Health.Status}}' partyhub 2>/dev/null || echo absent)"
  if [ "$health" = "healthy" ]; then pass "partyhub est healthy"; else fail "partyhub : $health (sudo docker logs partyhub)"; fi
else
  skip "Docker inaccessible : relancez avec sudo pour vérifier les conteneurs"
fi

# 2. Réponse HTTPS de l'application.
code="$(curl -sk -o "$TMP/health" -w '%{http_code}' --max-time 10 "$BASE/api/health")"
if [ "$code" = "200" ] && grep -q '"ok":true' "$TMP/health"; then
  pass "HTTPS répond : $BASE/api/health"
else
  fail "HTTPS ne répond pas correctement (code $code). Vérifiez l'adresse et que le port 443 est libre."
fi

# 3. Page d'installation du certificat et fichier téléchargeable.
page="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/certificat")"
if [ "$page" = "200" ]; then pass "page /certificat accessible"; else fail "page /certificat : code $page"; fi

curl -sk -D "$TMP/headers" -o "$TMP/racine.crt" --max-time 10 "$BASE/certificat/racine.crt" || true
if head -1 "$TMP/racine.crt" 2>/dev/null | grep -q 'BEGIN CERTIFICATE'; then
  pass "certificat racine téléchargeable : $BASE/certificat/racine.crt"
  ctype="$(tr -d '\r' < "$TMP/headers" | awk -F': ' 'tolower($1) == "content-type" {print $2}')"
  info "type du fichier : ${ctype:-inconnu}"
  openssl x509 -in "$TMP/racine.crt" -noout -subject -enddate -fingerprint -sha256 2>/dev/null | sed 's/^/INFO   /' || true
else
  fail "certificat racine absent ou illisible : $BASE/certificat/racine.crt"
fi

# 4. Le certificat téléchargé doit être reconnu : c'est ce que fait l'installation sur un appareil.
if [ -s "$TMP/racine.crt" ]; then
  trusted="$(curl -s --cacert "$TMP/racine.crt" -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/health")"
  if [ "$trusted" = "200" ]; then
    pass "le certificat téléchargé permet une connexion sans avertissement"
  else
    fail "le certificat téléchargé ne valide pas la connexion (code $trusted)"
  fi
fi

# 5. L'administration répond (la route est bien transmise à l'application).
admin="$(curl -sk --max-time 10 "$BASE/api/admin/session" || true)"
if echo "$admin" | grep -q '"authenticated"'; then
  pass "administration joignable : /api/admin/session"
else
  fail "administration injoignable : la réponse ne contient pas « authenticated »"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Installation vérifiée. Rappel : l'appareil doit avoir installé le certificat (page /certificat)."
  exit 0
fi
echo "$FAILED contrôle(s) en échec. Consultez les journaux : sudo docker compose logs --no-color"
exit 1
