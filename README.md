# PartyHub

Plateforme de jeux de soirée sur navigateur. L'écran principal (TV ou ordinateur) affiche la partie ;
chaque joueur rejoint avec son téléphone, sans rien installer ni créer de compte.

Jeux fournis (architecture modulaire, un dossier par jeu, voir [docs/ADDING-A-GAME.md](docs/ADDING-A-GAME.md)) :

Sur une installation neuve, les jeux intégrés sont désactivés : l'administrateur les active un par un, ou avec `BUILTIN_GAMES=on`. Une installation existante garde ses réglages. Les jeux installés depuis une source GitHub ou un paquet sont actifs.

| Jeu                        | Catégorie | Principe                                                                          |
| -------------------------- | --------- | --------------------------------------------------------------------------------- |
| 🧠 **Quiz Party**          | Quiz      | Questions à choix multiples, points et bonus de rapidité. Les mots-clés de chacun peuvent devenir les questions (IA). |
| 🧩 **Phrases à trous**     | Quiz      | L’IA écrit des phrases à trou. Chacun pose une carte dans le trou, puis tout le monde vote anonymement. |
| 💭 **Association express** | Soirée    | Écrivez le premier mot qui vous vient, puis votez anonymement pour le plus drôle. |
| 👉 **Plutôt qui ?**        | Soirée    | « Qui est le plus susceptible de… ? » Votez en secret et suivez la majorité.      |
| 🫣 **L’imposteur parmi nous** | Soirée  | Un imposteur ignore le mot secret : donnez des indices, puis démasquez-le. Quatre modes de jeu. |
| 🎤 **Karaoké** | Soirée | Cherchez une chanson sur YouTube et chantez un passage : l’écran le joue, votre voix est rejouée, et les autres notent. |
| 🃏 **Plus ou moins**       | Cartes    | Un paquet de 52 cartes : la suivante sera-t-elle plus haute ou plus basse ?       |
| ⚡ **Réflexe**             | Adresse   | Attendez le vert, puis touchez le plus vite possible.                             |
| 🃏 **Rami 51**             | Cartes    | Ouvrez à 51 points, posez vos combinaisons, videz votre main le premier.          |
| 🎴 **Tarot**               | Cartes    | Enchères, chien, écart et plis à quatre joueurs.                                  |

## Fonctionnalités

- Catalogue sur l'écran principal : fiche par jeu, filtres (joueurs, type, durée, IA, jeux récents), recherche, affichage en fiches ou en liste, création de salle avec code court et QR code.
- Salle d'attente avec joueurs connectés, joueurs prêts, réglages du jeu et bouton de lancement.
- Interface smartphone : pseudo, réponses tactiles, retour immédiat, reconnexion automatique.
- Reconnexion après coupure : un joueur absent garde sa place et ses points pendant le délai de grâce.
- Championnat du salon, pour tous les jeux multijoueurs : de 1 à 10 manches, 2 à 4 équipes, rangs de
  progression (Recrue à Légende), icônes de victoire et podium de fin de partie.
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
9. Cliquer sur **Rejouer avec les mêmes joueurs** (ou sur **Manche suivante** si un championnat est réglé dans le menu), puis sur **Retour au catalogue**.
10. Ouvrir `/admin`, se connecter, vérifier la salle dans la liste, puis désactiver Quiz Party : la salle en cours doit être fermée.

## Variables d'environnement

| Variable                             | Défaut                         | Rôle                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PARTYHUB_PORT`                      | `8282`                         | Port publié sur la machine hôte (Compose)                                                                                                                                                                                                                                                                          |
| `PARTYHUB_HOST`                      | vide                           | Adresse du serveur pour le HTTPS du réseau local (surcouche `deploy/https`, voir [docs/HTTPS-LAN.md](docs/HTTPS-LAN.md))                                                                                                                                                                                           |
| `ADMIN_PASSWORD`                     | généré                         | Mot de passe de l'administration, prioritaire s'il est défini                                                                                                                                                                                                                                                      |
| `LOG_LEVEL`                          | `info`                         | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                                                                                                                                                                                                                                                 |
| `LOG_DIR`                            | `DATA_DIR/logs`                | Dossier du journal des erreurs (fichier `partyhub.log`, JSON une ligne par événement)                                                                                                                                                                                                                              |
| `LOG_MAX_MB`                         | `5`                            | Taille d'un fichier de journal avant rotation (1 à 100)                                                                                                                                                                                                                                                            |
| `LOG_FILES`                          | `6`                            | Nombre d'anciens fichiers gardés en plus du courant                                                                                                                                                                                                                                                                |
| `COOKIE_SECURE`                      | `false`                        | `true` uniquement derrière un proxy HTTPS                                                                                                                                                                                                                                                                          |
| `TRUST_PROXY`                        | `loopback`                     | Proxys de confiance pour lire l'adresse réelle des joueurs dans `X-Forwarded-For`. Même syntaxe qu'Express : `loopback`, une adresse, ou un réseau comme `172.16.0.0/12` (voir [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md))                                                                                     |
| `DATA_DIR`                           | `./data` (`/data` dans Docker) | Dossier de la base SQLite                                                                                                                                                                                                                                                                                          |
| `DB_BACKUP_EVERY_HOURS`              | `24`                           | Sauvegarde automatique de la base, en heures (`0` pour la désactiver)                                                                                                                                                                                                                                              |
| `DB_BACKUP_KEEP`                     | `7`                            | Nombre de sauvegardes de la base conservées                                                                                                                                                                                                                                                                        |
| `DB_BACKUP_DIR`                      | `<DATA_DIR>/backups`           | Dossier des sauvegardes de la base                                                                                                                                                                                                                                                                                 |
| `ASSET_MAX_AUDIO_MB`                 | `15`                           | Taille maximale d'un fichier audio de la médiathèque (1 à 512)                                                                                                                                                                                                                                                     |
| `ASSET_MAX_VIDEO_MB`                 | `80`                           | Taille maximale d'une vidéo de la médiathèque (1 à 2048)                                                                                                                                                                                                                                                           |
| `ASSET_MAX_IMAGE_MB`                 | `5`                            | Taille maximale d'une image de la médiathèque (1 à 64)                                                                                                                                                                                                                                                             |
| `ASSET_MAX_FONT_MB`                  | `2`                            | Taille maximale d'une police de la médiathèque (1 à 16)                                                                                                                                                                                                                                                            |
| `BUILTIN_GAMES`                      | `off`                          | `on` active les jeux intégrés sur une installation neuve ; `off` les laisse désactivés (les installations existantes ne changent pas)                                                                                                                                                                              |
| `GITHUB_TOKEN`                       | vide                           | Jeton GitHub (lecture des releases). Requis pour les dépôts privés ; évite aussi la limite d'appels anonymes. Jamais affiché ni sauvegardé                                                                                                                                                                         |
| `AI_PROVIDER`                        | déduit de la clé               | Un ou plusieurs fournisseurs, par ordre de préférence, séparés par des virgules (ex. `groq,anthropic`). `none` ou `off` désactive l'IA. Sans valeur, un seul fournisseur est utilisé : le premier dont la clé est présente                                                                                         |
| `*_API_KEY`                          | vide                           | Clé d'un fournisseur : `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `AI_CUSTOM_API_KEY`. Sert à écrire les aventures du jeu « Aventure IA ». Sans clé utilisable, une histoire de secours est jouée. Reste sur le serveur |
| `AI_<FOURNISSEUR>_MODEL`             | voir tableau                   | Modèle utilisé chez ce fournisseur, par exemple `AI_GROQ_MODEL`. Obligatoire pour les fournisseurs sans modèle par défaut (tous les gratuits, et `custom`)                                                                                                                                                         |
| `AI_<FOURNISSEUR>_BASE_URL`          | adresse officielle             | Adresse de remplacement (passerelle ou proxy), en `http` ou `https`. Obligatoire pour `custom` (`AI_CUSTOM_BASE_URL`)                                                                                                                                                                                              |
| `AI_<FOURNISSEUR>_MAX_CALLS_PER_DAY` | illimité                       | Plafond d'appels sur 24 heures glissantes pour ce fournisseur (1 à 1000000). Une fois atteint, le fournisseur suivant de la liste répond. Sert à rester dans un palier gratuit                                                                                                                                     |
| `AI_TIMEOUT_MS`                      | `30000`                        | Délai maximal d'un appel à l'IA, de 5000 à 120000 ms                                                                                                                                                                                                                                                               |
| `AI_MAX_CALLS_PER_HOUR`              | `300`                          | Plafond global d'appels à l'IA par heure, tous fournisseurs confondus (1 à 100000)                                                                                                                                                                                                                                 |
| `YOUTUBE_API_KEY`                    | vide                           | Clé de l'API YouTube Data v3 : recherche de chansons du jeu « Karaoké ». Sans clé, les joueurs peuvent toujours coller un lien YouTube. Reste sur le serveur. Quota de 10 000 unités par jour (une recherche en coûte 100)                                                                                              |
| `PORT`, `HOST`                       | `8282`, `0.0.0.0`              | Écoute du serveur dans le conteneur                                                                                                                                                                                                                                                                                |

### Fournisseurs d'IA

Les identifiants ci-dessous se mettent dans `AI_PROVIDER`. Les variables `AI_<FOURNISSEUR>_…` reprennent ces identifiants en majuscules (`AI_GROQ_MODEL`, `AI_OPENROUTER_MODEL`, etc.).

| Identifiant  | Service                                    | Modèle par défaut  | Palier gratuit                         |
| ------------ | ------------------------------------------ | ------------------ | -------------------------------------- |
| `anthropic`  | Anthropic (API Claude)                     | `claude-haiku-5-5` | non                                    |
| `openai`     | OpenAI (API)                               | `gpt-4o-mini`      | non                                    |
| `groq`       | Groq                                       | aucun : à donner   | oui                                    |
| `openrouter` | OpenRouter                                 | aucun : à donner   | oui, pour les modèles marqués gratuits |
| `mistral`    | Mistral AI                                 | aucun : à donner   | oui                                    |
| `cerebras`   | Cerebras                                   | aucun : à donner   | oui                                    |
| `gemini`     | Google Gemini (API compatible OpenAI)      | aucun : à donner   | oui                                    |
| `custom`     | Autre service compatible avec l'API OpenAI | aucun : à donner   | selon le service                       |

- Les modèles gratuits et leurs quotas changent souvent : le nom du modèle se donne dans `AI_<FOURNISSEUR>_MODEL`, il n'est fixé nulle part dans le code. Vérifier la documentation du fournisseur avant de configurer.
- Les plafonds (par jour et par heure) sont comptés en mémoire : ils repartent de zéro au redémarrage du serveur.
- Quand un fournisseur échoue (erreur, délai dépassé, plafond atteint), le suivant de la liste prend le relais. Une partie interrompue (fin ou relance) ne déclenche pas de relais.
- Les fournisseurs gratuits ont été vérifiés d'après leur documentation, pas par un appel réel : faire un essai avant une soirée.
- Les clés peuvent aussi être saisies dans l'administration, section **Système → Intelligence artificielle** (derrière le mot de passe administrateur). Une clé saisie là prend le pas sur la variable d'environnement du même fournisseur, s'applique tout de suite et ne se réaffiche jamais. Le bouton **Tester** envoie un appel minimal pour vérifier la clé et le modèle.
- Les clés saisies dans l'administration sont chiffrées (AES-256-GCM) avec une clé locale, `ai-secret.key`, créée à côté de la base dans le dossier de données (droits 0600). Une sauvegarde de la base reste protégée sans ce fichier, mais une copie du dossier de données entier ne l'est pas. Sans `ai-secret.key` (restauration partielle, par exemple), les clés saisies deviennent illisibles : l'administration demande alors de les ressaisir. Sauvegarder ce fichier avec la base.
- Les modèles proposés pour une clé saisie dans l'administration sont des suggestions : vérifier chacun avec **Tester**, car les noms de modèles changent souvent.

### Images (Aventure IA et autres jeux)

Les images (portraits des personnages, fonds de décor) sont générées par une IA d'image, puis gardées dans une bibliothèque partagée et reprises dans les parties suivantes. Elles sont facultatives : sans clé, les jeux gardent leur rendu habituel.

| Variable                                        | Défaut                        | Rôle                                                                                      |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | vide                          | Cloudflare Workers AI (FLUX.1 schnell), gratuit dans la limite d'un quota quotidien.      |
| `MODELSCOPE_API_KEY`                            | vide                          | ModelScope (Qwen-Image). Usage non commercial uniquement, avec un compte Alibaba vérifié. |
| `MODELSCOPE_ALLOW_NONCOMMERCIAL`                | vide (désactivé)              | Mettre `1` pour déclarer un usage non commercial. Sans cela, ModelScope reste désactivé.  |
| `IMAGE_PROVIDERS`                               | ceux dont la clé est présente | Ordre d'appel, séparé par des virgules (ex. `cloudflare,modelscope`).                     |
| `IMAGE_MAX_PER_DAY`                             | `150`                         | Nombre maximal d'images par jour, tous fournisseurs confondus (1 à 100000).               |
| `IMAGE_TIMEOUT_MS`                              | `60000`                       | Délai maximal pour une image, de 5000 à 300000 ms.                                        |

- Les images sont stockées dans la base, et suivent ses sauvegardes. Le plafond journalier est compté en base, donc il survit au redémarrage.
- Les clés d'images se règlent dans l'environnement du serveur. Il n'y a pas encore d'écran d'administration pour elles.
- ModelScope n'est pas autorisé pour un usage commercial : pour un service public ou payant, utiliser Cloudflare, ou un autre fournisseur.

Réglages modifiables depuis l'administration (sans redémarrage) : joueurs maximum par salle, délai de
reconnexion, délai d'inactivité, durée maximale d'une salle, nombre de chiffres du code de salle (4 à 6, 4 par défaut).
Les salles déjà ouvertes gardent leur code. Pour chaque jeu (intégré, cartes, médias, plateau ou
paquet importé), l'administration permet aussi de modifier les réglages par défaut (durées, manches, etc.), la
présentation (nom, icône, description, durée estimée), la notice, et d'activer ou désactiver le jeu. Le nombre de
joueurs reste fixé par le code du jeu. La structure du jeu (cartes, cases, questions) d'un paquet ne change pas : il
se transforme en copie modifiable.

## Ajouter un jeu (paquets `.phgame`)

Un jeu peut être livré dans un seul fichier `.phgame` et importé dans l'administration, section « Paquets de jeux ».
Le fichier est vérifié avant installation : version du moteur, empreintes, licences, images et définition du jeu.
Le format, les règles et les limites sont décrits dans [docs/PHGAME.md](docs/PHGAME.md). Un exemple est fourni :
`examples/exemple-cartes.phgame`.

Les jeux de plateau (parcours avec dés et cases spéciales) se créent dans l'administration, section « Jeux de plateau ».
Ils ne sont pas encore livrables en paquet `.phgame`.

**Sources GitHub** : un jeu peut aussi être installé et mis à jour depuis la dernière release d'un dépôt GitHub
(section « Sources GitHub », sous les paquets). Mise à jour manuelle, ou automatique une fois par jour. Une seule version
par jeu est installée. Le modèle de publication pour les dépôts de jeux est dans [docs/PUBLIER-UN-JEU.md](docs/PUBLIER-UN-JEU.md).

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

Pour que le micro, la caméra et les capteurs de mouvement (gyroscope) des téléphones fonctionnent sur le réseau local, PartyHub doit être servi en HTTPS :
voir [docs/HTTPS-LAN.md](docs/HTTPS-LAN.md) (surcouche Caddy avec certificat interne).

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

## Sauvegarde complète des jeux et de la médiathèque

Dans l'administration, « Sauvegarde » propose deux formats :

- **ZIP complet** : jeux de cartes, de questions médias et de plateau, textes et notices modifiés, et les fichiers de
  la médiathèque avec leurs identifiants (les jeux les référencent par ces identifiants). Limite : 512 Mio de médias.
  Au-delà, copiez le dossier `assets` à part.
- **JSON** : les définitions seules, sans les fichiers, pour une copie légère ou une relecture.

À la restauration, rien n'est écrasé par défaut : une définition identique à une existante est ignorée (doublon), et
un fichier déjà présent n'est pas remplacé. Cochez « Remplacer les jeux de même nom » pour mettre à jour un jeu au lieu
d'en ajouter une copie. Le résumé indique ce qui a été ajouté, ignoré ou remplacé.

## Limites de la première version

- Les salles et leurs parties sont en mémoire : un redémarrage du serveur interrompt les parties en cours.
  Les réglages, les jeux activés et les statistiques, eux, sont persistés.
- Les sessions d'administration sont stockées dans la base : elles survivent à un redémarrage et expirent au bout de
  12 heures. Une restauration de sauvegarde rétablit aussi les sessions qu'elle contient, jusqu'à leur expiration.
- Sur un réseau local en HTTP, le navigateur de l'écran principal doit rester ouvert pendant la partie.
- Les jeux fournis sont volontairement simples : pas de blind test audio ni de dessin. Ils suivent le guide
  [docs/ADDING-A-GAME.md](docs/ADDING-A-GAME.md) pour en ajouter d'autres.

## Licence et ressources

PartyHub est distribué sous licence MIT (voir [LICENSE](LICENSE)).

Aucun graphisme, logo ni personnage n'est repris d'un produit existant. Les icônes sont des emoji Unicode.
Les contenus (questions du quiz, mots, prompts, cartes des jeux) sont fournis à titre d'exemple et modifiables dans le dossier de chaque jeu (`packages/games/src/<jeu>/*.fr.json`).
