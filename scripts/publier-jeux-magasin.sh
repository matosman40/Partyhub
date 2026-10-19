#!/usr/bin/env bash
#
# Publie les jeux de code d'un dossier d'export dans le dépôt de jeux du magasin.
#
# Pour chaque jeu, son dossier est copié dans jeux/<jeu>/ et un tag <jeu>-vX.Y.Z est posé sur le commit. Le magasin
# lit ce dossier au tag : pas de release, pas de fichier .phgame, pas de signature (voir docs/MAGASIN.md).
#
# Usage :  scripts/publier-jeux-magasin.sh <dossier-export> [auteur/depot] [branche]
#   <dossier-export>  dossier qui contient un sous-dossier par jeu : jeux de code (export) et jeux déclaratifs
#   auteur/depot      dépôt de jeux (défaut : matosman40/jeux-partyhub)
#   branche           branche où committer (défaut : main)
# Variables :
#   DRY_RUN=1            prépare le commit et les tags, sans rien pousser
#   PARTYHUB_GAMES_URL   adresse git du dépôt (miroir local, test)
#
# Une version publiée ne change jamais. Si un tag existe déjà avec un autre contenu, le script s'arrête : il faut
# augmenter `version` dans le manifest.json du jeu. Un jeu dont le tag existe avec le même contenu est ignoré.

set -euo pipefail

SOURCE_ARG="${1:-}"
REPO="${2:-matosman40/jeux-partyhub}"
BRANCH="${3:-main}"
DRY_RUN="${DRY_RUN:-0}"
URL="${PARTYHUB_GAMES_URL:-https://github.com/${REPO}.git}"

if [ -z "$SOURCE_ARG" ] || [ ! -d "$SOURCE_ARG" ]; then
  echo "Usage : $0 <dossier-export> [auteur/depot] [branche]" >&2
  exit 2
fi
for tool in git node; do
  command -v "$tool" >/dev/null || {
    echo "« $tool » est requis." >&2
    exit 1
  }
done

SOURCE="$(cd "$SOURCE_ARG" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Contrôles des dossiers, avant de toucher au dépôt. Sortie : une ligne « identifiant version » par jeu.
LISTE="$WORK/jeux.txt"
node - "$SOURCE" >"$LISTE" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const GAME_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
// Mêmes règles que le magasin à la lecture d'un tag : pas de point initial, pas de lien symbolique.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const errors = [];
const games = [];

function checkTree(dir, label, rel) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const where = rel ? `${rel}/${entry.name}` : entry.name;
    if (!NAME.test(entry.name)) errors.push(`${label}/${where} : nom refusé par le magasin`);
    if (entry.isSymbolicLink()) errors.push(`${label}/${where} : lien symbolique refusé`);
    else if (entry.isDirectory()) checkTree(path.join(dir, entry.name), label, where);
    else if (!entry.isFile()) errors.push(`${label}/${where} : entrée non prise en charge`);
  }
}

for (const id of fs
  .readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()) {
  const dir = path.join(root, id);
  const file = path.join(dir, 'manifest.json');
  if (!GAME_ID.test(id)) errors.push(`${id} : nom de dossier refusé (minuscules, chiffres, tirets)`);
  if (!fs.existsSync(file)) {
    errors.push(`${id} : manifest.json absent`);
    continue;
  }
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    errors.push(`${id} : manifest.json n'est pas du JSON valide`);
    continue;
  }
  if (m.id !== id) errors.push(`${id} : le manifeste annonce « ${m.id} »`);
  if (m.signature !== undefined) errors.push(`${id} : un manifeste du magasin ne porte pas de signature`);
  if (typeof m.name !== 'string' || m.name.trim().length < 1) errors.push(`${id} : "name" absent`);
  if (!VERSION.test(String(m.version))) errors.push(`${id} : version « ${m.version} » : forme X.Y.Z attendue`);
  if (m.kind === 'code') {
    if (m.requires !== undefined) errors.push(`${id} : "requires" ne se met pas dans un jeu de code`);
    if (!fs.existsSync(path.join(dir, 'src', 'server.ts')) || !fs.existsSync(path.join(dir, 'src', 'client.tsx'))) {
      errors.push(`${id} : src/server.ts et src/client.tsx sont requis`);
    }
  } else if (m.kind === 'declarative') {
    // Jeu déclaratif (cartes, plateau, questions, recettes) : son module doit être nommé. Le paquet est fait par le magasin.
    if (!Array.isArray(m.requires?.modules) || m.requires.modules.length === 0) {
      errors.push(`${id} : "requires.modules" doit nommer le module du jeu`);
    }
  } else {
    errors.push(`${id} : "kind" doit valoir "code" ou "declarative"`);
  }
  checkTree(dir, id, '');
  games.push(`${id} ${m.version}`);
}
if (games.length === 0) errors.push('aucun jeu trouvé dans le dossier');
if (errors.length > 0) {
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
for (const g of games) console.log(g);
JS

mapfile -t JEUX <"$LISTE"
echo "${#JEUX[@]} jeu(x) à publier depuis $SOURCE"

# 2. Lecture du dépôt de jeux (les tags sont lus par le clone).
DEPOT="$WORK/depot"
echo "Lecture de $REPO, branche $BRANCH"
git clone --quiet --branch "$BRANCH" "$URL" "$DEPOT"
git -C "$DEPOT" fetch --quiet --tags origin

# 3. Copie des dossiers dans jeux/<jeu>/, puis contrôle des tags existants.
mkdir -p "$DEPOT/jeux"
for ligne in "${JEUX[@]}"; do
  id="${ligne%% *}"
  rm -rf "$DEPOT/jeux/$id"
  cp -R "$SOURCE/$id" "$DEPOT/jeux/$id"
done
git -C "$DEPOT" add -A jeux

A_TAGUER=()
for ligne in "${JEUX[@]}"; do
  id="${ligne%% *}"
  version="${ligne#* }"
  tag="$id-v$version"
  if git -C "$DEPOT" rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    if git -C "$DEPOT" diff --quiet "refs/tags/$tag" -- "jeux/$id"; then
      echo "  = $tag déjà publié, contenu identique : ignoré"
    else
      echo "Le tag $tag existe avec un autre contenu : augmentez \"version\" dans le manifest.json du jeu $id," >&2
      echo "relancez l'export, puis le script. Rien n'a été poussé." >&2
      exit 1
    fi
  else
    A_TAGUER+=("$tag")
  fi
done

if [ "${#A_TAGUER[@]}" -eq 0 ]; then
  echo "Rien de nouveau à publier : tous les tags existent déjà."
  exit 0
fi

# 4. Commit (une seule fois, même pour plusieurs jeux), puis tags sur ce commit.
if git -C "$DEPOT" diff --cached --quiet; then
  echo "Aucun changement dans jeux/ : les tags pointent sur le commit actuel."
else
  git -C "$DEPOT" commit --quiet -m "Magasin : publication de ${#A_TAGUER[@]} jeu(x)"
fi
for tag in "${A_TAGUER[@]}"; do
  git -C "$DEPOT" tag "$tag"
  echo "  + $tag"
done

# 5. Envoi : la branche d'abord, puis les nouveaux tags.
if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN=1 : rien n'est poussé. Commit local : $(git -C "$DEPOT" rev-parse --short HEAD)."
  exit 0
fi
git -C "$DEPOT" push --quiet origin "HEAD:refs/heads/$BRANCH"
refs=()
for tag in "${A_TAGUER[@]}"; do refs+=("refs/tags/$tag"); done
git -C "$DEPOT" push --quiet origin "${refs[@]}"
echo "Publié : ${#A_TAGUER[@]} tag(s) sur $REPO. Le magasin les lira à sa prochaine vérification (ou via « Vérifier »)."
