# Parcours de bout en bout : jeu de code

`parcours.cjs` installe un jeu de code dans un serveur PartyHub, l'approuve dans l'administration, puis joue une
partie complète dans un vrai navigateur : deux téléphones, trois manches, « Fin de partie » sur la TV. Il échoue
aussi si la page ou la console remonte une erreur.

Il n'est pas lancé par `npm test` : il demande un serveur en marche et un navigateur.

## Prérequis

- un paquet `.phgame` signé, dont la clé publique est dans `DATA_DIR/cles-de-confiance/` (voir `docs/JEU-DE-CODE.md`) ;
- Playwright et un Chromium, chargés depuis `PLAYWRIGHT` et `CHROMIUM` ;
- un serveur lancé sur une base vide, avec le mot de passe administrateur choisi :

```bash
mkdir -p /chemin/vers/donnees/cles-de-confiance
cp cles/mon-jeu.pub.pem /chemin/vers/donnees/cles-de-confiance/
PORT=8290 HOST=127.0.0.1 DATA_DIR=/chemin/vers/donnees ADMIN_PASSWORD='mot-de-passe-de-test' \
  node packages/server/dist/index.js
```

## Lancement

```bash
PARTYHUB_URL=http://127.0.0.1:8290 \
PARTYHUB_ADMIN_PASSWORD='mot-de-passe-de-test' \
PHGAME=/chemin/vers/mon-jeu.phgame \
GAME_ID=mon-jeu \
PLAYWRIGHT=playwright \
CHROMIUM=/chemin/vers/chromium \
SHOTS=/chemin/vers/captures \
node e2e/jeu-de-code/parcours.cjs
```

- `GAME_ID` doit être l'identifiant du jeu dans le paquet ;
- `SHOTS` est facultatif : le dossier doit exister, il reçoit les captures de la revue et de la TV ;
- le script s'arrête au premier échec, en indiquant l'étape.

Le scénario suit le modèle « pile ou face » (`phgame new`). Pour un autre jeu, adapter les textes attendus et
les choix des téléphones dans `jouer()`.

## Parcours de l'éditeur

`editeur.cjs` suit l'éditeur de l'administration à l'écran : clé de signature, création depuis le modèle,
renommage, vérification (partie de robots), signature, puis approbation dans « Jeux de code ». Il n'a pas besoin
de paquet : le serveur doit être neuf (aucune clé de signature, aucun jeu de code).

```bash
PARTYHUB_URL=http://127.0.0.1:8290 \
PARTYHUB_ADMIN_PASSWORD='mot-de-passe-de-test' \
PLAYWRIGHT=playwright \
CHROMIUM=/chemin/vers/chromium \
node e2e/jeu-de-code/editeur.cjs
```

Il crée le jeu `editeur-essai`. Pour le rejouer, repartir d'une base vide.
