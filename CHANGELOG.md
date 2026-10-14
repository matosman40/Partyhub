# Changelog

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [versionnement sémantique](https://semver.org/lang/fr/).

## [0.5.0] - 2026-10-14

### Ajouté
- Format de paquet `.phgame`, version 1, pour les jeux déclaratifs : une archive ZIP avec le manifeste, la définition du jeu,
  les ressources graphiques, les données et les licences. Règles et limites dans `docs/PHGAME.md`.
- Import, activation, désactivation et suppression des paquets dans l'administration (section « Paquets de jeux »).
- Commande `phgame` (`npm run phgame -- pack` et `check`) pour construire et vérifier un paquet.
- Validation stricte avant installation : archive, chemins, types de fichiers, tailles, empreintes SHA-256, version du moteur,
  licences, images et définition du jeu. Les anomalies du contenu sont toutes affichées.
- Lancement de contrôle : deux parties jouées par des robots avant chaque installation.
- Mise à jour par version plus récente. Retour arrière et version identique au contenu différent : refusés.
- Paquet d'exemple `examples/exemple-cartes.phgame`, contrôlé et reconstruit à l'identique par l'intégration continue.
- Ressources graphiques d'un paquet actif servies par `/api/packages/<identifiant>/assets/…`.
- 42 tests nouveaux (archive ZIP, validation, service, migration), 302 au total.

### Modifié
- Base de données : version de schéma 2 (table `packages`). Migration automatique au premier démarrage, avec copie de sécurité.

### Migration et compatibilité
- Action automatique au premier démarrage : une copie de la base est créée dans `/data/migrations/`. Conservez-la jusqu'à
  avoir vérifié le bon fonctionnement de la version.
- Retour arrière vers 0.4.x : la version 0.4.x refuse une base de version 2. Restaurez la copie faite à la mise à jour,
  puis redéployez l'image 0.4.x.
- La sauvegarde JSON de l'administration ne contient pas les fichiers `.phgame` : sauvegardez aussi `DATA_DIR/games/`.

### Problèmes connus
- Les jeux JavaScript et l'émulation ne sont pas pris en charge. Aucun code de paquet n'est exécuté (voir `docs/PHGAME.md`).
- Les vues de cartes n'affichent pas encore les images des paquets.
- Pas de cache hors ligne ni de transfert entre téléphones : reportés à 0.7.0 (voir `docs/ROADMAP.md`).
- Non testé sur de vrais téléphones ni sur une TV.

## [0.4.0] - 2026-10-14

### Ajouté
- Trois jeux de cartes, disponibles dans le catalogue :
  - **Poker (Texas hold’em)** de 2 à 8 joueurs : blindes, mises, tapis, pots secondaires, croupier, 25 s par action.
  - **Rami 51** de 2 à 5 joueurs (avec le jeu de 108 cartes) : ouverture à 51 points, tierce franche, échange de joker, rami sec.
  - **Tarot à 4 joueurs** : enchères, chien, écart, obligations de couleur et d'atout, Excuse, petit au bout, chelem.
- Robots pour chacun des trois jeux (salle d'entraînement).
- Tests serveur : 260 au total, dont 10 pour le tarot, 37 pour Rami 51 et 16 pour le poker.
- Test navigateur des jeux de cartes (`scripts/games-browser.py`) : une partie avec robots et un téléphone réel par jeu,
  écran TV et téléphone en 390 px, sans erreur ni débordement. Lancé en intégration continue.

### Migration et compatibilité
- Aucune action manuelle. Aucune donnée existante n'est modifiée.

### Problèmes connus
- Tarot : une partie demande 4 joueurs ; la salle d'entraînement ne fournit que 3 robots, il faut donc un téléphone.
- Poker : la relance rouvre l'action à tous les joueurs encore en jeu (simplification documentée dans le module).
- Non testé sur de vrais téléphones ni sur une TV (seulement Chromium, tailles d'écran simulées).

## [0.3.0] - 2026-10-14

### Ajouté
- Versions du schéma de la base (`PRAGMA user_version`) et migrations ordonnées : chaque changement de schéma a un numéro.
- Copie de sécurité de la base dans `/data/migrations/` avant toute migration d'une base existante. Ces copies ne sont
  jamais supprimées automatiquement.
- Refus de démarrer sur une base plus récente que la version installée, pour ne pas l'abîmer lors d'un retour arrière.
- Tests : base neuve, migration d'une base ancienne avec conservation des données, base déjà à jour, base trop récente,
  annulation complète d'une migration en échec, ordre d'application.

### Modifié
- Les bases créées par la version 0.2.x (version de schéma 0) passent automatiquement à la version 1 au premier démarrage.
  Le schéma lui-même n'a pas changé.

### Migration et compatibilité
- Action automatique au premier démarrage : une copie de la base est créée dans `/data/migrations/`. Conservez-la jusqu'à
  avoir vérifié le bon fonctionnement de la version.
- Le schéma de la version 1 est identique à celui de 0.2.x : un retour vers 0.2.x reste possible sans restauration.

### Problèmes connus
- Non encore testé sur un vrai serveur CasaOS (voir `docs/ROADMAP.md`).

## [0.2.0] - 2026-10-14

### Ajouté
- Image Docker publiée sur GHCR (`ghcr.io/matosman40/partyhub`), en `amd64` et `arm64`, téléchargeable sans compte.
- `compose.yaml` pour les utilisateurs : utilise l'image, sans compilation. `compose.dev.yaml` pour les développeurs (compilation locale).
- Icône et métadonnées CasaOS complètes (catégorie, description, port).
- Labels OCI dans l'image (source, version, commit).
- Intégration continue sur chaque pull request et chaque commit de `main` : typecheck, tests, build, construction de l'image,
  test de navigation sur cinq tailles d'écran (téléphones, tablette, ordinateur, TV).
- Publication automatique à partir d'un tag `vX.Y.Z` : contrôle du tag et de la version, tests, publication de l'image,
  vérification de l'image téléchargée sans authentification, création de la release avec les notes de ce changelog.

### Modifié
- Installation : `docker compose up -d` télécharge l'image. La compilation n'est plus nécessaire.
- Mise à jour : `git pull`, puis `docker compose pull` et `docker compose up -d`.

### Migration et compatibilité
- Aucune action manuelle. Le volume `partyhub-data` est réutilisé.
- Les installations faites avec `docker compose up -d --build` peuvent passer à l'image publiée sans perte de données.

### Problèmes connus
- Le paquet GHCR doit être rendu public une fois, dans les réglages GitHub, pour que l'installation sans authentification fonctionne.
- Non encore testé sur un vrai serveur CasaOS ni sur des téléphones réels (voir `docs/ROADMAP.md`).

## [0.1.1] - 2026-10-14

### Corrigé
- Le fichier `.env.example` manquait dans le dépôt publié : la commande `cp .env.example .env` du README échouait.

### Ajouté
- Vérification automatique de l'installation décrite dans le README, sur un serveur Linux avec Docker
  (GitHub Actions) : démarrage, état « healthy », mot de passe généré, mise à jour.

### Migration et compatibilité
- Aucune.

### Problèmes connus
- Non encore testé sur un vrai serveur CasaOS ni sur des téléphones réels (voir `docs/ROADMAP.md`).

## [0.1.0] - 2026-10-14

Première version publiée sur GitHub. Elle reprend l'état validé du projet (tests et build passants).

### Ajouté
- Plateforme de jeux de soirée sur navigateur : écran principal (TV ou ordinateur) et téléphones des joueurs.
- Jeux fournis : Quiz Party, Association express, Plutôt qui ?, L'Imposteur, Plus ou moins, Réflexe,
  Bombes party, Cartes couleurs, Cartes coco, Président, Promoteur, Loups du village, Sudoku, Solitaire,
  Taquin, Mots croisés.
- Salles avec code court et QR code, reconnexion après coupure, mode entraînement avec robots.
- Administration protégée par mot de passe, sauvegardes automatiques de la base SQLite.
- Déploiement Docker Compose avec métadonnées CasaOS, healthcheck et utilisateur non privilégié.

### Migration et compatibilité
- Aucune action manuelle. Les bases existantes sont mises à jour automatiquement au démarrage.

### Problèmes connus
- Les salles et les parties sont en mémoire : un redémarrage du serveur interrompt les parties en cours.
- Sur un réseau local en HTTP, l'écran principal doit rester ouvert pendant la partie.
- L'image Docker n'est pas encore publiée sur GHCR : l'installation CasaOS demande aujourd'hui une compilation locale.
