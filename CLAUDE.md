# PartyHub : consignes pour les agents Claude

Ce fichier est lu automatiquement par Claude Code au début de chaque session. Il résume ce qu'il faut savoir pour travailler sur ce dépôt. Le détail du projet est dans le dossier `claude/` du projet PartyHUb.

## Branche et livraison

- Travailler sur `feature/plateau-grille` (plateau de test 3D). Ne jamais fusionner dans `main`.
- Ne committer et pousser que lorsque l'utilisateur a accepté le travail.
- Chaque commit se termine par ces deux lignes :

  ```
  Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
  Claude-Session: <URL de la session Claude en cours>
  ```

- Les fichiers temporaires (captures, scripts de test, sorties) vont dans un dossier hors du dépôt, jamais à la racine.

## Commandes

Toutes les commandes se lancent à la racine du dépôt.

| Besoin | Commande |
|---|---|
| Installer les dépendances | `npm install` |
| Construire un paquet partagé | `npm run build -w @partyhub/shared` |
| Construire tout | `npm run build` |
| Types | `npm run typecheck` |
| Tests complets | `npm test` |
| Tests d'un paquet | `npm test -w @partyhub/shared` (ou `games`, `server`, `web`) |
| Lint | `npm run lint` |
| Format | `npm run format:check` (ou `npm run format` pour corriger) |
| Serveur de dev | `npm run dev:server` |
| Interface de dev | `npm run dev:web` |

- Reconstruire `shared` (`npm run build -w @partyhub/shared`) avant de tester les autres paquets : `games`, `server` et `web` importent ses fichiers compilés.
- Avant de livrer : tests du paquet touché, typecheck, lint, format. Pour un changement visuel, vérifier aussi dans un navigateur.
- Vérification navigateur : garder le serveur de test sur le port 8294 pour ne pas gêner le serveur de dev.

## Points de vigilance

- `packages/shared/src/grille.ts` et `grille-themes.ts` sont partagés par le serveur, le téléphone et le téléviseur. Proposer un plan avant de changer leurs règles.
- Le projet doit tourner sous Windows, où les noms de fichiers ne sont pas sensibles à la casse. Deux fichiers qui ne diffèrent que par la casse (`Capture.tsx` et `capture.ts`, par exemple) cassent la compilation. Vérifier les noms avant d'en créer un.
- `better-sqlite3` demande Python et des outils de compilation. Sans eux, `npm install --ignore-scripts` reste possible, mais le serveur ne démarre pas en local.
- Ne jamais désactiver la vérification SSL de npm (`strict-ssl`) de façon permanente.

## Travail avec les agents

- Une tâche = un thème, une règle ou un bug. Préférer plusieurs demandes courtes à une grosse demande.
- Relire le diff avant chaque commit.
