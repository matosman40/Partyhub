# Feuille de route

Ce document liste ce qui est prévu. Les éléments marqués **Fait** sont dans le dépôt ; les autres ne le sont pas encore.
Rien ici n'est une promesse de date.

## Déploiement et CasaOS

| Élément | État |
|---|---|
| Installation par `docker compose up -d --build` depuis le dépôt | Fait (voir README) |
| Image Docker publiée sur GHCR, en `amd64` et `arm64`, téléchargeable sans compte | À faire |
| Fichier `compose.yaml` sans compilation (utilise l'image GHCR) et `compose.dev.yaml` pour compiler localement | À faire |
| Icône et miniature dans les métadonnées CasaOS | À faire |
| Test de l'installation sur une machine Docker, puis sur un serveur CasaOS | À faire |
| Procédure de mise à jour et de retour arrière par version | À faire (le retour arrière dépend des migrations) |

## Versions et données

| Élément | État |
|---|---|
| Versions `0.x` avec tags Git et notes de version (`CHANGELOG.md`) | Fait pour 0.1.0 |
| Migrations de base numérotées, suivies par `PRAGMA user_version` (sans effet sur les bases existantes) | À faire |
| Sauvegarde automatique avant chaque migration | À faire |
| Intégration continue sur pull request : installation, typecheck, tests, build, build d'image sans publication | À faire |
| Publication d'image sur GHCR uniquement à partir d'un tag validé | À faire |

## Jeux

| Élément | État |
|---|---|
| 16 jeux fournis (voir `CHANGELOG.md`) | Fait |
| Poker Texas hold'em | Code écrit, à valider dans le navigateur, non inclus dans 0.1.0 |
| Rami 51 et Tarot (4 joueurs) | En préparation, non intégrés |
| Format de jeu autonome `.phgame` (archive vérifiée, lancement sans réseau) | En préparation, non intégré |
| Éditeurs de cartes et de plateau | À faire |
| Médiathèque partagée entre les jeux | À faire |
| Reprise de l'écran principal par un autre appareil (WebRTC) | À faire |
| Application installable et jeu hors ligne (PWA) | À faire |

## Sécurité et qualité

| Élément | État |
|---|---|
| Recherche de secrets dans l'historique (outil dédié) | À faire |
| `npm audit` et revue des licences des dépendances | À faire |
| Persistance des salles et des parties (aujourd'hui en mémoire) | À étudier |
| Tests sur de vrais téléphones (Android et iOS) | À faire |

## Contribution

| Élément | État |
|---|---|
| `CONTRIBUTING.md`, modèles d'issues et de pull request | À faire |
| Règles de branches (`main` protégée, revue avant fusion) | À faire |

## Limites connues de la version 0.1.0

- Les salles et les parties sont en mémoire : un redémarrage du serveur les interrompt.
- Les sessions d'administration sont perdues au redémarrage.
- En HTTP sur réseau local, l'écran principal doit rester ouvert pendant la partie.
