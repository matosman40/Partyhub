# Changelog

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [versionnement sémantique](https://semver.org/lang/fr/).

## [0.7.0] - 2026-10-14

### Ajouté
- Format de paquet 2 : les jeux de plateau et les jeux de questions peuvent être livrés dans un `.phgame`. Un paquet
  porte exactement un module : `cards`, `board` ou `quiz`.
- Jeux de questions en paquet : vidéos YouTube seulement (identifiant et plage de lecture). Les fichiers de la
  médiathèque sont refusés dans un paquet.
- Exemples `examples/exemple-plateau/` et `examples/exemple-quiz/`. Chacun pèse environ 1,4 Ko.
- Fabrique de jeux par module (`packages/server/src/packages/factory.ts`). Le lancement de contrôle fonctionne pour
  tous les modules, avec le nombre de joueurs du manifeste.
- Copie modifiable d'un paquet actif (« Créer une copie modifiable » dans l'administration) : la copie est un jeu de
  l'administration, éditable en entier (nom, description, cartes, cases, questions, règles). Le paquet reste inchangé.
- Sources GitHub en dépôt commun : `auteur/depot/jeu`, avec des tags `<jeu>-vX.Y.Z`. Une source dédiée à un seul jeu
  (`auteur/nom`) fonctionne comme avant.
- Versions multiples d'un paquet : la version jouée et les versions conservées sont listées dans l'administration
  (« Versions »). Une version plus ancienne s'importe sans être jouée ; « Jouer cette version » fait le retour arrière.
  Une source GitHub qui trouve une version plus ancienne que celle jouée la conserve et la signale comme « conservée ».
- Tests : 12 nouveaux pour le format 2, 5 pour la copie, 9 pour les versions et les sources.

### Modifié
- Moteur déclaré en 0.7.0, avec les modules `cards`, `board` et `quiz`. Versions des paquets portées à 0.7.0.
- Identifiants des jeux issus de paquets : `pkg-` pour les cartes (inchangé), `pkgb-` pour les plateaux, `pkgq-` pour
  les questions.
- Une mise à jour qui change le module d'un paquet installé est refusée : il faut un autre identifiant.
- Une version plus ancienne n'est plus refusée : elle est conservée sans être jouée. La suppression d'un paquet efface
  toutes ses versions.
- Le modèle de publication (`docs/PUBLIER-UN-JEU.md`) utilise la version 0.7.0 du moteur.

### Migration et compatibilité
- Une migration de base de données (schéma 5) ajoute la table `package_archives` pour les versions conservées. Elle ne
  modifie aucune ligne existante, et une copie de sécurité de la base est faite avant. Les paquets de cartes déjà
  installés restent valides et gardent leur identifiant.
- Retour arrière vers 0.6.3 : la version 0.6.3 refuse une base de version 5. Restaurez la copie faite à la mise à jour,
  puis redéployez l'image 0.6.3.
- Un paquet de format 2 ne s'installe pas sur une version antérieure à 0.7.0.

### Problèmes connus
- Hors paquet : les jeux en temps réel (type Bomberman) et les jeux de mouvement (type Just Dance). Un paquet ne porte que
  des données ; ces mécaniques restent du code intégré, ou demanderont le bac à sable JavaScript de la version 0.9.0.
- Les vidéos et les sons de la médiathèque ne peuvent pas être embarqués dans un paquet.
- Les jeux de plateau et de questions venus d'un paquet sont vérifiés par les tests serveur et le lancement de contrôle ;
  leur affichage dans un navigateur reste à vérifier sur de vrais téléphones.
- Aucune release GitHub de test n'a encore été créée pour ces modules.

## [0.6.3] - 2026-10-14

### Ajouté
- Sources GitHub pour les paquets `.phgame` : un dépôt `auteur/nom` dont la dernière release contient le paquet et son
  fichier `.sha256`. Installation et mise à jour depuis l'administration, à la demande ou une fois par jour.
- Dépôts privés avec la variable `GITHUB_TOKEN`. Le jeton n'est jamais affiché, journalisé ni sauvegardé.
- Vérifications strictes : empreinte SHA-256 de la release, version du tag égale à celle du manifeste, paquet d'un autre
  dépôt refusé, redirection hors GitHub refusée, taille limitée.
- Modèle de publication pour les dépôts de jeux : [docs/PUBLIER-UN-JEU.md](docs/PUBLIER-UN-JEU.md).
- Tests : 25 nouveaux (sources, empreintes, jeton, mise à jour automatique, jeux intégrés) avec un faux client GitHub.
- Réglage `BUILTIN_GAMES` (`off` par défaut) : sur une installation neuve, les jeux intégrés restent dans le code mais sont désactivés. L'administrateur les active un par un.

### Modifié
- Base de données : version de schéma 4 (table `package_sources`). Migration automatique au premier démarrage, avec copie de sécurité.

### Migration et compatibilité
- Action automatique au premier démarrage : une copie de la base est créée dans `/data/migrations/`.
- Retour arrière vers 0.6.2 : la version 0.6.2 refuse une base de version 4. Restaurez la copie faite à la mise à jour,
  puis redéployez l'image 0.6.2.
- Aucune source n'est ajoutée automatiquement : rien ne change tant qu'une source n'est pas créée.
- Installation neuve : les jeux intégrés sont désactivés. Une installation existante (mot de passe administrateur déjà créé) n'est pas modifiée.

### Problèmes connus
- Les sources ne sont pas incluses dans la sauvegarde JSON de l'administration ; elles sont dans la copie de la base.
- Un seul fichier `.phgame` par release, et une seule version active par jeu.
- Le modèle de publication pour les dépôts de jeux n'a pas encore été exécuté sur GitHub.
- Non testé sur de vrais téléphones ni sur une TV.

## [0.6.2] - 2026-10-14

### Ajouté
- Jeux de plateau : un nouveau type de jeu, défini par des données. Un parcours de 8 à 60 cases, avec sept types de cases :
  normale, avance, recule, gain de points, perte de points, passe le prochain tour, et arrivée (toujours la dernière case).
- Éditeur de plateaux dans l'administration (section « Jeux de plateau ») : nom, icône, thème, règles, tableau des cases
  avec aperçu, notice. Création, modification, copie et suppression. Les erreurs de règle sont affichées telles quelles.
- Déroulement : un ou deux dés par tour, minuteur de tour optionnel qui lance les dés à la place du joueur, classement final
  (les arrivés d'abord, dans l'ordre d'arrivée). Les robots jouent aussi en salle d'entraînement.
- Les plateaux sont inclus dans la sauvegarde complète. Une sauvegarde faite avant cette version se restaure sans erreur.
- 34 tests nouveaux (règles de jeu, validation, service, API, sauvegarde, migration), 354 au total.

### Modifié
- Base de données : version de schéma 3 (table `board_games`). Migration automatique au premier démarrage, avec copie de sécurité.

### Migration et compatibilité
- Action automatique au premier démarrage : une copie de la base est créée dans `/data/migrations/`. Conservez-la jusqu'à
  avoir vérifié le bon fonctionnement de la version.
- Retour arrière vers 0.6.1 : la version 0.6.1 refuse une base de version 3. Restaurez la copie faite à la mise à jour,
  puis redéployez l'image 0.6.1.
- Les paquets `.phgame` ne peuvent pas encore contenir de plateau.

### Problèmes connus
- Pas d'export ni d'import de fichier pour un plateau (contrairement aux jeux de cartes) : utilisez la sauvegarde complète.
- Les cases n'ont pas d'image : seulement un nom, un effet et une valeur.
- Si le joueur dont c'est le tour est déconnecté et qu'il n'y a pas de limite de temps, la partie attend son retour.
- Non testé sur de vrais téléphones ni sur une TV.

## [0.6.1] - 2026-10-14

### Ajouté
- Polices dans la médiathèque : WOFF2, WOFF, TTF et OTF. Le format est vérifié sur le contenu du fichier.
- Police choisie par jeu de cartes (« Police des cartes »). Le navigateur la charge et l'applique aux cartes.
- Limite de taille des polices configurable : `ASSET_MAX_FONT_MB` (2 Mo par défaut).
- 7 tests nouveaux (détection des polices, validation de la police, limites), 320 au total.

### Corrigé
- Une image de dos de carte ou une police utilisée par un jeu de cartes peut de nouveau être vérifiée avant suppression :
  la médiathèque refuse la suppression tant qu'un jeu l'utilise (c'était une limite connue de 0.6.0).

### Modifié
- Les messages d'erreur de la médiathèque citent les formats de police acceptés.

### Migration et compatibilité
- Aucune action. Aucun changement de base de données. Les paquets `.phgame` ne peuvent pas utiliser de police de la médiathèque.

### Problèmes connus
- Éditeur de plateau : reporté à 0.6.2, en attente d'une décision de conception.
- Non testé sur de vrais téléphones ni sur une TV.

## [0.6.0] - 2026-10-14

### Ajouté
- Dos de carte personnalisé dans l'éditeur de jeux de cartes : couleur de fond, texte centré (16 caractères maximum) et
  image de la médiathèque. Sans réglage, le dos suit le thème graphique. Aperçu directement dans l'éditeur.
- Limites de taille de la médiathèque configurables : `ASSET_MAX_AUDIO_MB` (15 par défaut), `ASSET_MAX_VIDEO_MB` (80),
  `ASSET_MAX_IMAGE_MB` (5). L'administration affiche désormais les limites réellement appliquées au lieu de valeurs fixes.
- 11 tests nouveaux (dos de carte, limites de configuration), 313 au total.

### Modifié
- L'administration ne code plus les limites de la médiathèque : elle les reçoit du serveur.

### Migration et compatibilité
- Aucune action. Aucun changement de base de données. Les jeux existants gardent le dos de leur thème.
- Un paquet `.phgame` ne peut pas utiliser une image de la médiathèque pour son dos : ses ressources restent dans son archive.

### Problèmes connus
- L'image recouvre entièrement la couleur de fond : la couleur n'est visible que sans image, ou avec une image transparente.
- La suppression d'une image utilisée comme dos n'est pas bloquée : le dos reprend alors sa couleur de fond.
- Éditeur de plateau et polices : reportés à 0.6.1 (voir `docs/ROADMAP.md`).
- Non testé sur de vrais téléphones ni sur une TV.

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
