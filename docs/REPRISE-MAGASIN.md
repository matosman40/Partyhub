# Reprise : magasin unique et publication des jeux de code

Document de reprise. À lire en premier pour continuer ce chantier depuis une autre session, ou après un redémarrage.
Date de l'état : 2026-11-05.

## Où en est-on

- **Plan** : `docs/PLAN-MAGASIN-UNIQUE.md` (décisions validées, avancement, points bloquants).
- **Jeux de code construits** : `packages/games/code-games/` (plus-ou-moins, reflexe, plutot-qui), version **2.0.3**.
  Liste des jeux qui peuvent être remplacés par un paquet : `MIGRATED_BUILTIN_IDS` dans `packages/server/src/games-registry.ts`.
- **Publication** : workflow `publier-code.yml` dans `matosman40/jeux-partyhub` (branche `feature/publier-jeux-code`).
  Tags `code/<jeu>-vX.Y.Z`. Les releases **2.0.3 existent** (publiées), mais elles sont **signées avec l'ancienne clé**.

## Problème à régler en premier : la clé

La clé privée d'origine a été exposée dans une conversation. Elle a signé les releases 2.0.3
(identifiant `624b0eada9c33c61`). Il faut :

1. Créer une nouvelle paire de clés, hors du dépôt :
   `node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');require('fs').writeFileSync('ph-signing-key-2.pem',k.privateKey.export({type:'pkcs8',format:'pem'}));require('fs').writeFileSync('ph-signing-key-2.pub.pem',k.publicKey.export({type:'spki',format:'pem'}));"`
2. Remplacer le secret `PHGAME_SIGNING_KEY` (dépôt `matosman40/jeux-partyhub`) par le contenu de `ph-signing-key-2.pem`.
3. Supprimer l'ancienne paire (`ph-signing-key.pem`, `ph-signing-key.pub.pem`).
4. Republier en **2.0.4** (il faut bumper les trois modules et les trois `manifest.json`, puis tagger `code/<jeu>-v2.0.4`).
5. Décider du sort des releases 2.0.3 (suppression : action destructive, à confirmer explicitement).
6. Distribuer la clé publique `ph-signing-key-2.pub.pem` aux installations (`DATA_DIR/cles-de-confiance/`).

## Commandes utiles

- Construire un paquet localement (clé de test) : `node packages/server/dist/cli/phgame.js pack <dossier> <sortie.phgame> <cle.pem>`
  puis `node packages/server/dist/cli/phgame.js check <sortie.phgame> <cle-publique.pem>`.
- Vérifier une release : télécharger `<jeu>.phgame` depuis la release, puis `check` avec la clé publique.
- Statut des runs (API publique) : `https://api.github.com/repos/matosman40/jeux-partyhub/actions/runs`.
- Journal d'un run : interface GitHub (connexion nécessaire). L'API donne seulement les étapes en échec.

## Pièges connus

- Les tags pointent sur un commit figé : une correction exige une **nouvelle version**, jamais une réécriture de tag.
- Le workflow n'a pas de `actions/checkout` : `gh` doit recevoir `--repo`.
- Le CSS des vues vient du build de l'interface : le workflow construit `@partyhub/web` avant de signer.
- Les fins de ligne Windows (CRLF) cassent les ancres de remplacement de fichiers : normaliser avant d'éditer.

## Convention de tags (corrigée)

Le magasin ne lit que les tags `<jeu>-vX.Y.Z`. Les tags `code/<jeu>-vX.Y.Z` utilisés jusqu'ici sont **invisibles** pour lui.
Les jeux de code utilisent désormais `<jeu>-vX.Y.Z`. Les deux workflows de `jeux-partyhub` (branche
`feature/publier-jeux-code`) commencent par un job d'aiguillage : si `packages/games/code-games/<jeu>` existe dans PartyHub,
c'est `publier-code.yml` qui agit, sinon `publier.yml`.

Constat au 2026-11-05 (test du magasin sur un serveur de test) : le magasin voit `plus-ou-moins-v1.0.2`, signé par une
autre clé (`b74b3e02b58cac70`), et refuse de l'installer tant que cette clé n'est pas dans `DATA_DIR/cles-de-confiance/`.
Les releases `code/…-v2.0.3` sont signées par `624b0eada9c33c61` (ancienne clé exposée).

## Reste à faire (ordre)

1. Nouvelle clé, secret mis à jour, republication en 2.0.4 (ci-dessus).
2. Installer un paquet depuis le magasin sur un serveur de test (avec la clé publique en place), approuver, activer, jouer une manche.
3. Publier les paquets de code sur le magasin de façon définitive, puis mettre à jour `docs/PLAN-MAGASIN-UNIQUE.md`.
4. Étapes 2 à 4 du plan (cartes et plateau, quiz et IA, reste).
