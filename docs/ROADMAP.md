# Feuille de route

Ce document décrit le plan par version. Une version n'est publiée (tag Git, notes de version, image) qu'après
validation de son contenu. Les dates ne sont pas engagées : seuls les critères comptent.

Légende : **Fait** = dans le dépôt. **À faire** = pas commencé. **En cours** = code existant hors du dépôt, à intégrer.

## Règles de publication (pour chaque version)

- Tag Git `vX.Y.Z` sur un commit de `main` dont les contrôles sont verts.
- Notes de version dans `CHANGELOG.md` : ajouté, modifié, corrigé, sécurité, migration, problèmes connus.
- Image Docker `X.Y.Z` sur GHCR (à partir de 0.2.0), tag `latest` seulement après validation.
- Une version déjà publiée n'est jamais remplacée : un correctif devient une nouvelle version.
- Chaque publication demande une autorisation explicite.

## Vue d'ensemble

| Version | Thème | Contenu principal | État |
|---|---|---|---|
| 0.1.0 | Première publication | Code validé, licence MIT, installation par compilation locale | **Fait** |
| 0.1.1 | Correctifs de documentation | Corrections après test sur un vrai Docker et CasaOS | À faire |
| 0.2.0 | Installation sans compilation | Image GHCR, compose sans `build:`, icône CasaOS, CI, publication sur tag | À faire |
| 0.3.0 | Données et migrations | Migrations `user_version`, sauvegarde avant migration, test de montée de version | À faire |
| 0.4.0 | Jeux de cartes et poker | Poker validé en navigateur, Rami 51, Tarot | En cours (hors dépôt) |
| 0.5.0 | Jeux autonomes `.phgame` | Format de paquet, import dans l'administration, exécution isolée, cache | En cours (hors dépôt) |
| 0.6.0 | Éditeurs et médiathèque | Éditeur de cartes et de plateau, médiathèque partagée | À faire |
| 0.7.0 | Reprise d'écran et contexte hors ligne | Reprise de l'écran principal (WebRTC), application installable (PWA) | À faire |
| 0.8.0 | Robustesse des parties | Salles et parties survivant à un redémarrage, sessions d'administration persistantes | À étudier |
| 1.0.0 | Première version stable | Critères ci-dessous | À faire |

## Détail par version

### 0.1.1 : correctifs de documentation
- Tester les commandes du README sur une machine Docker (`compose up -d --build`, `ps`, `logs`, mise à jour).
- Corriger ce qui échoue, sans changement de comportement.
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

### 0.4.0 : jeux de cartes et poker
- Poker : validation dans le navigateur (téléphones et écran), puis intégration.
- Rami 51 : module, vues et tests présents dans une copie de travail ; intégration après relecture et test navigateur.
- Tarot à 4 joueurs : même processus.
- Critère : chaque jeu se termine sans blocage, avec des tests serveur et un test navigateur par jeu.

### 0.5.0 : format `.phgame`
Objectif : un jeu livré dans un seul fichier (code, graphismes, sons, données, licences), importable depuis l'administration,
installable hors ligne.
- Format : archive ZIP avec `manifest.json`, `game/`, `assets/`, `data/`, `licenses/`, et empreintes SHA-256 de chaque fichier.
- Validation avant import : chemins, types de fichiers, taille, version du moteur, empreintes. Tout fichier malformé est refusé.
- Exécution : les jeux déclaratifs (données seules) sont rendus par le moteur ; les jeux JavaScript tournent dans un
  bac à sable WebAssembly séparé du serveur, sans accès au système. Aucun code importé ne s'exécute dans Node.js.
- Stockage : `/data/games/<id>/<version>/`, mise en cache locale, lancement sans réseau.
- Transfert entre téléphones avec vérification d'intégrité avant installation.
- Documentation : différence entre jeux déclaratifs, jeux JavaScript et émulation (non prise en charge en 0.5.0).
- Critère : un paquet d'exemple est importé, lancé, mis en cache, et joué réseau coupé.

### 0.6.0 : éditeurs et médiathèque
- Éditeur de cartes (familles, valeurs, dos, règles de base) et éditeur de plateau.
- Médiathèque partagée : images, sons et polices réutilisables entre jeux, avec limites configurables.
- Critère : un jeu créé dans l'éditeur se lance sans modification du code.

### 0.7.0 : reprise d'écran et contexte hors ligne
- Reprise de l'écran principal par un autre appareil, via WebRTC (contrôle de la partie en cours).
- Application installable (PWA) : cache versionné de l'interface, paquets `.phgame` disponibles hors ligne.
- Contraintes : HTTPS requis hors `localhost`, documenté avec les options de reverse proxy.
- Critère : la reprise d'écran fonctionne entre deux appareils réels ; le jeu démarre réseau coupé.

### 0.8.0 : robustesse des parties
- Persister les salles et les parties (aujourd'hui en mémoire) afin qu'un redémarrage ne les interrompe pas.
- Sessions d'administration persistantes.
- Option : à décider après étude (complexité et intérêt pour un usage familial).

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
