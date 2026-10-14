# PartyHub

Plateforme de jeux de soirée sur navigateur. L'écran principal (TV ou ordinateur) affiche la partie ;
chaque joueur rejoint avec son téléphone, sans rien installer ni créer de compte.

Jeux fournis (architecture modulaire, un dossier par jeu, voir [docs/ADDING-A-GAME.md](docs/ADDING-A-GAME.md)) :

| Jeu | Catégorie | Principe |
| --- | --- | --- |
| 🧠 **Quiz Party** | Quiz | Questions à choix multiples, points et bonus de rapidité. |
| 💭 **Association express** | Soirée | Écrivez le premier mot qui vous vient, puis votez anonymement pour le plus drôle. |
| 👉 **Plutôt qui ?** | Soirée | « Qui est le plus susceptible de… ? » Votez en secret et suivez la majorité. |
| 🕵️ **L'Imposteur** | Soirée | Un imposteur ignore le mot secret : donnez des indices, puis démasquez-le. |
| 🃏 **Plus ou moins** | Cartes | Un paquet de 52 cartes : la suivante sera-t-elle plus haute ou plus basse ? |
| ⚡ **Réflexe** | Adresse | Attendez le vert, puis touchez le plus vite possible. |
| ♠️ **Poker** | Cartes | Texas hold’em : mises, bluff et meilleure main de cinq cartes. |
| 🃏 **Rami 51** | Cartes | Ouvrez à 51 points, posez vos combinaisons, videz votre main le premier. |
| 🎴 **Tarot** | Cartes | Enchères, chien, écart et plis à quatre joueurs. |

## Fonctionnalités

- Catalogue sur l'écran principal, création de salle avec code court et QR code.
- Salle d'attente avec joueurs connectés, joueurs prêts, réglages du jeu et bouton de lancement.
- Interface smartphone : pseudo, réponses tactiles, retour immédiat, reconnexion automatique.
- Reconnexion après coupure : un joueur absent garde sa place et ses points pendant le délai de grâce.
- Administration protégée par mot de passe : activer ou désactiver les jeux, consulter les salles,
  supprimer les salles inactives, régler les limites.
- Persistance SQLite (réglages, jeux activés, statistiques) dans un volume Docker.
- Aucun service externe, aucune clé API : tout fonctionne sur le réseau local.

## Installation (Docker Compose, CasaOS)

Prérequis : Docker avec le plugin Compose (`docker compose version`), et un terminal sur le serveur
(sur CasaOS : application Terminal, ou SSH). L'image est téléchargée depuis GHCR : aucune compilation n'est nécessaire.

```bash
# 1. Télécharger PartyHub (le fichier compose.yaml indique la version à installer)
sudo mkdir -p /DATA/AppData && cd /DATA/AppData
sudo git clone https://github.com/matosman40/Partyhub.git partyhub
cd partyhub

# 2. Configurer (adapter ADMIN_PASSWORD, et PARTYHUB_PORT si 8282 est déjà utilisé)
sudo cp .env.example .env
sudo nano .env

# 3. Télécharger l'image et démarrer
sudo docker compose up -d

# 4. Vérifier : le service doit afficher « healthy » après quelques secondes
sudo docker compose ps
sudo docker compose logs -f     # Ctrl+C pour quitter
```

Ouvrir `http://<adresse-du-serveur>:8282` sur l'écran principal, puis `http://<adresse-du-serveur>:8282/join`
sur les téléphones (ou scanner le QR code). Le détail pour CasaOS est dans [docs/CASAOS.md](docs/CASAOS.md).

**Mise à jour** (les données du volume `partyhub-data` sont conservées) :

```bash
cd /DATA/AppData/partyhub
sudo git pull                      # récupère la nouvelle version du compose.yaml
sudo docker compose pull           # télécharge l'image de cette version
sudo docker compose up -d
```

Ne jamais lancer `docker compose down -v` : l'option `-v` supprime les données.

**Mot de passe administrateur** : si `ADMIN_PASSWORD` est vide, un mot de passe aléatoire est écrit une seule fois
dans le volume (`/data/admin-password.txt`). Lisez-le, puis supprimez le fichier :

```bash
sudo docker compose exec partyhub cat /data/admin-password.txt
sudo docker compose exec partyhub rm /data/admin-password.txt
```

**Compilation locale (développeurs)** : `sudo docker compose -f compose.dev.yaml up -d --build`.

## Développement local

Prérequis : Node.js 22.12 ou plus récent, npm, et les outils de compilation habituels
(`python3`, `make`, `g++`) pour `better-sqlite3` si aucun binaire précompilé n'est disponible.

```bash
npm install
npm run build          # compile shared, games, web puis server
npm test               # tests d'intégration et unitaires (serveur réel sur port aléatoire)
npm run typecheck      # vérification des types de tous les packages
```

Lancer en développement avec rechargement à chaud (deux terminaux) :

```bash
npm run build -w @partyhub/games     # une fois, les vues de jeu sont importées compilées
npm run dev:server                   # API et Socket.IO sur le port 8282
npm run dev:web                      # interface sur http://localhost:5173 (relais vers 8282)
```

## Structure du projet

```
packages/
├── shared/    Contrats communs : protocole Socket.IO, types des jeux, schémas Zod, codes de salle
├── games/     Jeux (plugins) : logique serveur + vues React ; registre explicite des jeux
│   └── src/quiz-party/   Quiz Party (module.ts, questions.fr.json, client/) ; autres jeux sur le même modèle
├── server/    Backend Node.js : HTTP (Express), temps réel (Socket.IO), salles, base SQLite
│   └── src/__tests__/    Tests d'intégration (flow) et unitaires du moteur (quiz)
└── web/       Frontend React + Vite : accueil, écran TV, joueur, administration
docs/          Installation CasaOS, ajout d'un jeu, accès distant
compose.yaml   Déploiement Docker Compose (métadonnées CasaOS incluses)
Dockerfile     Build multi-étapes, utilisateur non privilégié, healthcheck
```

Le serveur est l'unique autorité sur les états de jeu et les scores. Le navigateur n'envoie que des
intentions (« réponse 2 »), jamais un score ou une bonne réponse. Chaque client ne reçoit que sa vue :
la bonne réponse n'apparaît qu'à la révélation, et les réponses privées restent privées.

## Scénario de test manuel (plusieurs téléphones)

1. Démarrer le serveur, ouvrir l'accueil sur un ordinateur ou une TV, puis cliquer sur **Créer la salle** de Quiz Party.
2. Noter le code affiché ou scanner le QR code avec un premier téléphone.
3. Entrer un pseudo différent sur deux autres téléphones (ou onglets privés). Vérifier que le pseudo déjà pris est refusé.
4. Sur chaque téléphone, toucher **Je suis prêt !**. Vérifier le compteur « prêt(s) » sur l'écran principal.
5. Régler le nombre de questions et le temps de réponse, puis cliquer sur **Lancer la partie**.
6. Répondre depuis les téléphones. Vérifier que l'écran principal affiche la révélation dès que tous ont répondu.
7. Couper le Wi-Fi d'un téléphone quelques secondes, le rétablir : le joueur doit retrouver sa place sans changer de score.
8. Vérifier le classement après chaque question puis le classement final, avec les égalités.
9. Cliquer sur **Rejouer avec les mêmes joueurs**, puis sur **Retour au catalogue**.
10. Ouvrir `/admin`, se connecter, vérifier la salle dans la liste, puis désactiver Quiz Party : la salle en cours doit être fermée.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PARTYHUB_PORT` | `8282` | Port publié sur la machine hôte (Compose) |
| `ADMIN_PASSWORD` | généré | Mot de passe de l'administration, prioritaire s'il est défini |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `COOKIE_SECURE` | `false` | `true` uniquement derrière un proxy HTTPS |
| `TRUST_PROXY` | `loopback` | Proxys de confiance pour lire l'adresse réelle des joueurs dans `X-Forwarded-For`. Même syntaxe qu'Express : `loopback`, une adresse, ou un réseau comme `172.16.0.0/12` (voir [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md)) |
| `DATA_DIR` | `./data` (`/data` dans Docker) | Dossier de la base SQLite |
| `DB_BACKUP_EVERY_HOURS` | `24` | Sauvegarde automatique de la base, en heures (`0` pour la désactiver) |
| `DB_BACKUP_KEEP` | `7` | Nombre de sauvegardes de la base conservées |
| `DB_BACKUP_DIR` | `<DATA_DIR>/backups` | Dossier des sauvegardes de la base |
| `ASSET_MAX_AUDIO_MB` | `15` | Taille maximale d'un fichier audio de la médiathèque (1 à 512) |
| `ASSET_MAX_VIDEO_MB` | `80` | Taille maximale d'une vidéo de la médiathèque (1 à 2048) |
| `ASSET_MAX_IMAGE_MB` | `5` | Taille maximale d'une image de la médiathèque (1 à 64) |
| `ASSET_MAX_FONT_MB` | `2` | Taille maximale d'une police de la médiathèque (1 à 16) |
| `PORT`, `HOST` | `8282`, `0.0.0.0` | Écoute du serveur dans le conteneur |

Réglages modifiables depuis l'administration (sans redémarrage) : joueurs maximum par salle, délai de
reconnexion, délai d'inactivité, durée maximale d'une salle.

## Ajouter un jeu (paquets `.phgame`)

Un jeu peut être livré dans un seul fichier `.phgame` et importé dans l'administration, section « Paquets de jeux ».
Le fichier est vérifié avant installation : version du moteur, empreintes, licences, images et définition du jeu.
Le format, les règles et les limites sont décrits dans [docs/PHGAME.md](docs/PHGAME.md). Un exemple est fourni :
`examples/exemple-cartes.phgame`.

Les jeux de plateau (parcours avec dés et cases spéciales) se créent dans l'administration, section « Jeux de plateau ».
Ils ne sont pas encore livrables en paquet `.phgame`.

## Sécurité

- Les réponses et les scores sont validés côté serveur ; les commandes sont limitées en fréquence par socket.
- Les codes de salle inconnus sont ralentis par adresse : au-delà de 50 codes différents en 10 minutes, une adresse
  reçoit une réponse toutes les 2 secondes. Les connexions valides ne sont jamais ralenties, et les codes répétés ne
  comptent pas.
- Les envois de médiathèque sont lus en flux : rien n'est gardé en mémoire, et la taille maximale est contrôlée pendant l'envoi.
- Les commandes d'hôte ne sont acceptées que d'un socket ayant présenté le jeton d'hôte, reçu une seule fois à la création.
- Les commandes déjà traitées (même `commandId`) sont ignorées : pas de double réponse.
- L'administration exige une session cookie `httpOnly`, `SameSite=strict`, et la connexion est limitée à 5 tentatives par 15 minutes.
- En-têtes de sécurité (CSP, `nosniff`, `frame-ancestors`). Les journaux ne contiennent jamais de réponse ni de jeton.
- Le conteneur tourne avec l'utilisateur `node`, sans capacités Linux superflues.

Pour un accès depuis Internet, voir [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md) : HTTPS obligatoire, administration
bloquée depuis l'extérieur, de préférence via un VPN.

## Sauvegarde et restauration de la base

PartyHub sauvegarde sa base (profils, statistiques, réglages, jeux) chaque jour, dans le dossier `backups` du
dossier de données (`/data/backups` dans Docker). Sept copies sont conservées. La copie est cohérente même pendant
que le serveur fonctionne. L'administration, section « Base de données », affiche les sauvegardes et en crée une
immédiatement.

Avant chaque mise à jour du schéma (migration), une copie de la base est créée dans `migrations/` (`/data/migrations` dans Docker). Ces copies ne sont jamais supprimées automatiquement : conservez celle de la version précédente jusqu’à avoir vérifié la nouvelle version.

Ces fichiers contiennent des données personnelles (pseudos, statistiques) : ne les publiez pas.

Copie hors du serveur :

```bash
sudo docker cp partyhub:/data/backups ./sauvegardes-partyhub
```

Restauration. Attention : la base actuelle est remplacée, et tout ce qui a été fait depuis la sauvegarde est perdu.

```bash
sudo docker compose stop partyhub
sudo docker run --rm -v partyhub-data:/data alpine sh -c \
  'cp /data/backups/partyhub-AAAAMMJJ-HHMMSS.db /data/partyhub.db && rm -f /data/partyhub.db-wal /data/partyhub.db-shm'
sudo docker compose start partyhub
```

Remplacez `partyhub-AAAAMMJJ-HHMMSS.db` par le nom voulu (date en UTC, affichée dans l'administration). Les fichiers
de la médiathèque (dossier `assets`) ne sont pas dans la sauvegarde : copiez-les à part.

## Limites de la première version

- Les salles et leurs parties sont en mémoire : un redémarrage du serveur interrompt les parties en cours.
  Les réglages, les jeux activés et les statistiques, eux, sont persistés.
- Les sessions d'administration sont perdues au redémarrage (il faut se reconnecter).
- Sur un réseau local en HTTP, le navigateur de l'écran principal doit rester ouvert pendant la partie.
- Les jeux fournis sont volontairement simples : pas de blind test audio ni de dessin. Ils suivent le guide
  [docs/ADDING-A-GAME.md](docs/ADDING-A-GAME.md) pour en ajouter d'autres.

## Licence et ressources

PartyHub est distribué sous licence MIT (voir [LICENSE](LICENSE)).

Aucun graphisme, logo ni personnage n'est repris d'un produit existant. Les icônes sont des emoji Unicode.
Les contenus (questions du quiz, mots, prompts, cartes des jeux) sont fournis à titre d'exemple et modifiables dans le dossier de chaque jeu (`packages/games/src/<jeu>/*.fr.json`).
