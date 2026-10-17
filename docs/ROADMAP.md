# Feuille de route

Ce document décrit le plan par version. Une version n'est publiée (tag Git, notes de version, image) qu'après
validation de son contenu. Les dates ne sont pas engagées : seuls les critères comptent.

Légende : **Fait** = dans le dépôt. **À faire** = pas commencé. **En cours** = code existant hors du dépôt, à intégrer.

## Règles de publication (pour chaque version)

- Tag Git `vX.Y.Z` sur un commit de `main` dont les contrôles sont verts. Le tag déclenche la publication de l'image (à partir de 0.2.0).
- Notes de version dans `CHANGELOG.md` : ajouté, modifié, corrigé, sécurité, migration, problèmes connus.
- Image Docker `X.Y.Z` sur GHCR (à partir de 0.2.0), tag `latest` seulement après validation.
- Une version déjà publiée n'est jamais remplacée : un correctif devient une nouvelle version.
- Chaque publication demande une autorisation explicite.

## Vue d'ensemble

| Version | Thème | Contenu principal | État |
|---|---|---|---|
| 0.1.0 | Première publication | Code validé, licence MIT, installation par compilation locale | **Fait** |
| 0.1.1 | Correctifs de documentation | Fichier `.env.example` rétabli ; installation vérifiée par GitHub Actions | **Fait** (tag à créer) |
| 0.2.0 | Installation sans compilation | Image GHCR, compose sans `build:`, icône CasaOS, CI, publication sur tag | **Prêt sur `main`** (tag à créer, puis paquet GHCR rendu public) |
| 0.3.0 | Données et migrations | Migrations `user_version`, sauvegarde avant migration, test de montée de version | **Prêt sur `main`** (tag à créer) |
| 0.4.0 | Jeux de cartes | Poker, Rami 51 et Tarot intégrés, tests serveur et navigateur | **Prêt sur `main`** (tag à créer) |
| 0.5.0 | Paquets `.phgame` | Format 1 (jeux déclaratifs), import et contrôle dans l'administration, CLI, paquet d'exemple | **Prêt sur `main`** (tag à créer). Cache hors ligne et transfert reportés à 0.7.0 |
| 0.6.0 | Éditeurs et médiathèque (partie 1) | Dos de carte personnalisé, limites de la médiathèque configurables | **Prêt sur `main`** (tag à créer) |
| 0.6.1 | Polices de la médiathèque | Polices WOFF2, WOFF, TTF, OTF pour les cartes ; usages vérifiés avant suppression | **Prêt sur `main`** (tag à créer) |
| 0.6.2 | Éditeur de plateau | Format de plateau déclaré en données, éditeur | **Prêt sur `main`** (tag à créer). Paquets `.phgame` de plateau reportés |
| 0.6.3 | Sources GitHub | Installation et mise à jour des paquets depuis les releases d'un dépôt (publiques ou privées), manuelles ou quotidiennes | **Prêt sur la branche** `version-0.6.3` (pull request à ouvrir) |
| 0.7.0 | Paquets de plateau et de questions, reprise d'écran et contexte hors ligne | Format 2 (plateau, questions YouTube), reprise de l'écran principal (WebRTC), application installable (PWA), cache des paquets, transfert entre téléphones | **Tag `v0.7.0` posé** : format 2 livré. Reprise d'écran, cache des paquets et transfert entre téléphones ne sont pas livrés |
| 0.8.0 | Robustesse des parties | Salles et parties survivant à un redémarrage (à faire) ; sessions d'administration persistantes (**Fait**, migration 6) | À étudier |
| 0.9.0 | Jeux JavaScript | Code de paquet exécuté dans un bac à sable WebAssembly, limites de temps et de mémoire | À faire (revue de sécurité requise) |
| 0.11.0 | Réactivité et capteurs | Funambule, Micro-défis, capteurs relayés, retours immédiats au téléphone, premier chargement allégé | **Publiée** (tag `v0.11.0`) |
| 0.12.0 | Recettes et sauvegarde complète | Format 3 (recettes et écrans déclaratifs), catalogue en fiches, championnat, Banquise, sauvegarde avec les paquets installés | **Prête, non publiée** : tag à poser après validation |
| 1.0.0 | Première version stable | Critères ci-dessous | À faire |

## Détail par version

### 0.1.1 : correctifs de documentation
- Vérifié par GitHub Actions sur un serveur Linux avec Docker : `cp .env.example .env`, `up -d --build`, état « healthy », mot de passe généré, mise à jour.
- Corrigé : `.env.example` manquait dans le dépôt publié.
- Reste à faire : un test sur un vrai serveur (CasaOS).
- Critère : les commandes du README fonctionnent telles quelles sur une machine propre.

### 0.2.0 : installation sans compilation
- Dockerfile : labels OCI (`source`, `version`, `revision`).
- Workflow de vérification sur pull request : `npm ci`, typecheck, tests, build, build d'image sans publication.
- Workflow de publication déclenché par un tag `vX.Y.Z` : build `linux/amd64` et `linux/arm64`, tags `X.Y.Z` et `X.Y`,
  permissions limitées au `GITHUB_TOKEN`.
- `compose.yaml` pour utilisateurs (image GHCR, sans `build:`), `compose.dev.yaml` pour développeurs (build local).
- Métadonnées `x-casaos` : icône et miniature publiques.
- Paquet GHCR rendu public, puis test `docker pull` sans authentification.
- Documentation : installation CasaOS par import du compose depuis l'URL GitHub, mise à jour, sauvegarde.
- Critère : une installation vierge réussit sur CasaOS en suivant la documentation, sans compilation.

### 0.3.0 : données et migrations
- Remplacer le `migrate()` actuel par une liste ordonnée de migrations suivies par `PRAGMA user_version`.
- La base existante est reconnue à l'état « version 0 » sans modification.
- Sauvegarde automatique avant toute migration, avec conservation du fichier précédent.
- Test : copie d'une base réelle, montée de version, données intactes.
- Documentation du retour arrière : restaurer la sauvegarde puis redéployer la version précédente.
- Critère : une mise à jour depuis 0.2.0 ne perd aucune donnée, et le retour arrière est testé.

### 0.4.0 : jeux de cartes
- Poker (Texas hold’em) : blindes, mises, tapis, pots secondaires. Testé en navigateur (écran et téléphone).
- Rami 51 : ouverture à 51 points, tierce franche, échange de joker, rami sec. Testé en navigateur.
- Tarot à 4 joueurs : enchères, chien, écart, Excuse, petit au bout, chelem.
- Test navigateur : `scripts/games-browser.py`, lancé en intégration continue.
- Critère atteint : chaque jeu se termine sans blocage (tests serveur) et s'affiche sans erreur (test navigateur).
- Reste à faire : essai sur de vrais téléphones et une TV.

### 0.5.0 : paquets `.phgame`
Objectif : un jeu livré dans un seul fichier, importable depuis l'administration et vérifié avant installation.
Détail du format et des règles : `docs/PHGAME.md`.
- **Fait** : format 1 pour les jeux déclaratifs (définition de jeu de cartes, ressources graphiques, données, licences).
- **Fait** : validation stricte (archive ZIP restreinte, chemins, types de fichiers, tailles, empreintes SHA-256, version du moteur, licences, images, définition).
- **Fait** : lancement de contrôle avant chaque installation (deux parties jouées par des robots).
- **Fait** : import, activation, désactivation et suppression dans l'administration ; versions multiples conservées, avec retour arrière par activation d'une version conservée.
- **Fait** : commande `phgame pack` et `phgame check` ; paquet d'exemple reconstruit à l'identique en intégration continue.
- **Fait** : migration de schéma 2 (table `packages`), testée depuis une base de version 1.
- **Reporté à 0.7.0** : cache hors ligne des paquets installés et lancement réseau coupé ; transfert entre téléphones avec
  vérification d'intégrité.
- **Reporté à 0.9.0** : exécution du code JavaScript des paquets dans un bac à sable. Aucun code de paquet n'est exécuté aujourd'hui.
- Émulation rétro : hors périmètre, non prise en charge.
- Critère partiel : un paquet d'exemple est importé, vérifié, lancé et joué. Le critère « joué réseau coupé » passe à 0.7.0.

### 0.6.0 : éditeurs et médiathèque (partie 1)
- **Fait** : dos de carte personnalisé (couleur, texte, image de la médiathèque), avec aperçu dans l'éditeur. Les paquets `.phgame` ne peuvent pas référencer la médiathèque.
- **Fait** : limites de taille de la médiathèque configurables (`ASSET_MAX_AUDIO_MB`, `ASSET_MAX_VIDEO_MB`, `ASSET_MAX_IMAGE_MB`). L'interface affiche les limites réellement appliquées.
- **Déjà présent** : éditeur de cartes (familles, valeurs, règles, notice) et médiathèque partagée pour les jeux de questions (audio, vidéo, image).
- **Reporté** : polices à 0.6.1, éditeur de plateau à 0.6.2.
- Critère : un jeu de cartes créé dans l'éditeur se lance sans modification du code (atteint).

### 0.6.1 : polices de la médiathèque
- **Fait** : polices WOFF2, WOFF, TTF et OTF dans la médiathèque. Format vérifié sur le contenu du fichier ; limite `ASSET_MAX_FONT_MB` (2 Mo par défaut).
- **Fait** : police choisie par jeu de cartes, chargée par le navigateur et appliquée aux cartes (testé dans un navigateur).
- **Fait (correction de 0.6.0)** : une image de dos ou une police utilisée par un jeu ne peut plus être supprimée de la médiathèque.
- Critère : une police téléversée s'affiche dans un jeu (atteint).

### 0.6.2 : éditeur de plateau
- **Fait** : format de plateau déclaré en données (parcours de 8 à 60 cases, sept types de cases, un ou deux dés, durée de tour), jouable sans modification du code. Le plateau de Promoteur reste figé.
- **Fait** : décision de conception : un nouveau type de jeu de plateau (catégorie « plateau »), distinct des jeux de cartes.
- **Fait** : éditeur dans l'administration, sauvegarde et restauration, robots, classement final.
- **Reporté** : export et import de fichier de plateau, images sur les cases. Les plateaux dans les paquets `.phgame` sont faits en 0.7.0 (format 2).
- Critère : un plateau créé dans l'éditeur se joue sans modification du code (atteint en test serveur ; à confirmer sur de vrais téléphones).

### 0.7.0 : paquets de plateau et de questions, reprise d'écran et contexte hors ligne
- **Fait (branche `version-0.7.0`)** : format de paquet 2. Un paquet peut porter un jeu de plateau (module `board`) ou un jeu
  de questions (module `quiz`, vidéos YouTube seulement). Pas de code exécuté, paquets de quelques Ko. Détail : `docs/PHGAME.md`.
- **Reste à faire** : jeux de mouvement et temps réel dans un paquet : relèvent du bac à sable JavaScript (0.9.0), ou de
  modules intégrés au dépôt.
- Reprise de l'écran principal par un autre appareil, via WebRTC (contrôle de la partie en cours).
- Application installable (PWA) : cache versionné de l'interface, paquets `.phgame` disponibles hors ligne.
- Transfert d'un paquet `.phgame` entre téléphones, avec vérification d'intégrité avant installation (reporté depuis 0.5.0).
- Contraintes : HTTPS requis hors `localhost`, documenté avec les options de reverse proxy.
- Critère : la reprise d'écran fonctionne entre deux appareils réels ; le jeu démarre réseau coupé.

### 0.8.0 : robustesse des parties
- Persister les salles et les parties (aujourd'hui en mémoire) afin qu'un redémarrage ne les interrompe pas.
- **Fait** : sessions d'administration persistantes, stockées dans la base avec expiration (migration 6).
- Option : à décider après étude (complexité et intérêt pour un usage familial).

### 0.9.0 : jeux JavaScript en bac à sable
- Exécution du code d'un paquet `kind: javascript` dans un bac à sable WebAssembly (QuickJS), séparé du serveur.
- Aucun accès au système de fichiers, au réseau ni aux variables d'environnement du serveur.
- Limites de temps de calcul et de mémoire par partie ; API minimale (état, actions, vues).
- Revue de sécurité indépendante avant publication : c'est un prérequis, pas une étape facultative.
- Critère : un jeu JavaScript d'exemple est installé et joué ; des tests montrent qu'il ne peut ni lire un fichier du serveur ni appeler le réseau.
- Reste à décider : le sous-ensemble d'API exposé aux paquets.

### 1.0.0 : première version stable
Critères, tous requis :
- Installation CasaOS validée depuis la documentation, sur au moins un serveur réel.
- Mise à jour sans perte de données, retour arrière testé.
- Migrations testées sur une base réelle.
- Tests sur de vrais téléphones (Android et iOS) pour les jeux principaux.
- `npm audit` sans vulnérabilité critique ou haute non justifiée, licences des dépendances vérifiées.
- Recherche de secrets dans l'historique faite, aucun secret trouvé.
- `CONTRIBUTING.md`, modèles d'issues et de pull request, règles de branche en place.

## Éléments transversaux (toutes versions)

- Chaque pull request décrit son impact sur Docker, CasaOS et les données.
- Aucune fonctionnalité déclarée « faite » sans test automatisé ou vérification navigateur.
- Les limites connues de chaque version sont listées dans `CHANGELOG.md`.

## Limites connues de la version 0.1.0

- Les salles et les parties sont en mémoire : un redémarrage du serveur les interrompt.
- Les sessions d'administration sont perdues au redémarrage.
- En HTTP sur réseau local, l'écran principal doit rester ouvert pendant la partie.
