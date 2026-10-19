# Jeux de code (format 5) : créer, construire, signer, installer

**Statut : prototype testé de bout en bout.** Un jeu de code se crée, se modifie et se vérifie dans l'administration (éditeur), ou avec les outils de ligne de commande ci-dessous. PartyHub ne détient aucune clé de signature : l'auteur signe le paquet hors de PartyHub, puis le paquet entre par le dossier de dépôt, par un lien HTTPS ou par téléversement. Il s'installe après relecture. Le module serveur (les règles) s'exécute dans un isolat V8 sans réseau ; les vues s'exécutent dans un iframe sandboxé. Les limites sont en fin de document.

Un jeu de code est un paquet `.phgame` (format 5) qui contient le code compilé du jeu : un module serveur (les règles) et des vues pour l'écran principal, le téléphone et les réglages.

Pour créer un jeu avec un assistant IA, utiliser le prompt de `docs/PROMPT-JEU-DE-CODE.md`.

## Créer un jeu dans l'administration (recommandé)

Dans l'administration, « Créer des jeux » → « Jeux de code » → « Créer et modifier un jeu de code ». Pas de ligne de commande : une seule image PartyHub suffit.

1. **Créer.** Identifiant, nom et auteur : le jeu est créé depuis le modèle, dans `DATA_DIR/jeux-en-cours/<identifiant>`. Un identifiant déjà pris par un jeu intégré ou par un autre brouillon est refusé.
2. **Modifier.** Choisir un fichier (`src/server.ts` pour les règles, `src/client.tsx` pour les écrans, `manifest.json`, `README.md`, `licenses/`), le modifier, puis enregistrer (Ctrl+S ou « Enregistrer le fichier »). Le nom, la description et la version se règlent dans « Informations du jeu » : ils sont écrits dans `manifest.json` et dans `src/server.ts` ensemble, pour rester identiques.
3. **Vérifier.** Construit le jeu sans signature, puis joue une partie complète avec des robots dans l'isolat de production. La suite n'est proposée qu'après une vérification réussie de la version actuelle : toute modification la rend caduque.
4. **Signer hors de PartyHub.** L'éditeur affiche alors la commande de signature. Elle se lance avec la clé privée de l'auteur, qui ne quitte jamais son poste : `phgame pack DATA_DIR/jeux-en-cours/<identifiant> <identifiant>.phgame <cle-privee.pem>`. La clé publique correspondante doit être dans `DATA_DIR/cles-de-confiance/` (voir « Installer dans PartyHub »).
5. **Ajouter le paquet.** Trois voies, au choix : déposer le `.phgame` dans le dossier `DATA_DIR/depot-jeux`, coller son adresse HTTPS dans « Ajouter un jeu de code », ou le téléverser dans « Paquets de jeux (.phgame) ». Le jeu arrive dans « Jeux de code », en attente de revue : relire le code, cocher la case et approuver. Il ne joue qu'après approbation, comme tout paquet.

Règles :

- Une version déjà installée ne se réinstalle pas avec un contenu différent : monter le numéro de version dans « Informations du jeu ».
- Le brouillon ne joue jamais. Le supprimer n'affecte pas les versions déjà installées.
- Seuls les fichiers texte sont éditables (`.ts`, `.tsx`, `.json`, `.md`, `.txt`), 200 Ko au plus par fichier. Les images et les sons ne se téléversent pas encore dans l'éditeur.
- La construction ne lit que le dossier du brouillon, les dépendances installées et les paquets de l'application : un `import` vers un autre fichier (un secret, par exemple) est refusé.
- Pour modifier un jeu créé dans l'éditeur, ouvrir son brouillon : c'est la source. Un paquet `.phgame` reçu d'ailleurs ne contient que le code compilé ; il ne se modifie pas dans l'éditeur.

## Créer un jeu avec Docker (ligne de commande)

Aucune installation de Node n'est nécessaire : les outils sont dans l'image PartyHub. Depuis la racine du dépôt, définissez une fois la commande, puis lancez les étapes :

```bash
# 1. Créer un jeu depuis le modèle (dans ./jeux-en-cours/mon-jeu)
PHGAME='docker compose -f compose.dev.yaml run --rm -v ./jeux-en-cours:/jeu -v ./cles:/cles --entrypoint node partyhub /app/packages/server/dist/cli/phgame.js'
$PHGAME new /jeu/mon-jeu mon-jeu "Mon jeu" "Votre nom"

# 2. Créer les clés de signature (une fois ; la clé privée reste dans ./cles, jamais dans le dépôt)
$PHGAME keygen /cles/mon-jeu

# 3. Construire et signer le paquet
$PHGAME pack /jeu/mon-jeu /jeu/mon-jeu.phgame /cles/mon-jeu.key.pem

# 4. Contrôler : structure, signature, syntaxe, puis une partie complète jouée par des robots
$PHGAME check /jeu/mon-jeu.phgame /cles/mon-jeu.pub.pem
```

Il n'y a plus d'image `jeux` séparée : les outils tournent dans le conteneur PartyHub, qui a accès au réseau pour servir la page. Le code d'un jeu, lui, tourne dans un isolat (isolated-vm) auquel PartyHub ne fournit que le moteur de jeu : aucune API réseau ni accès fichier n'y est injecté. Seuls les dossiers `jeux-en-cours` et `cles` sont montés.

**Non vérifié :** l'image Docker n'a pas pu être construite dans l'environnement où ce prototype a été mis au point (le téléchargement des images est bloqué). Les mêmes commandes, lancées avec Node, ont été testées (voir ci-dessous).

Sans Docker, les mêmes commandes existent avec `npm run phgame -- <commande>` à la racine du dépôt (après `npm ci` et `npm run build`).

## Structure d'un jeu de code

```
mon-jeu/
├── manifest.json        identité du jeu (voir ci-dessous)
├── src/
│   ├── server.ts        module serveur : les règles (export par défaut, un GameModule)
│   └── client.tsx       vues : Settings, Host et Player (export par défaut)
├── assets/              images et sons (facultatif, chacun couvert par une licence)
└── licenses/            licence du jeu et attributions (au moins un fichier)
```

`src/` n'entre pas dans le paquet : seuls le code compilé (`code/server.js`, `code/client.js`), `assets/` et `licenses/` sont inclus.

### manifest.json

```json
{
  "format": "phgame",
  "formatVersion": 5,
  "kind": "code",
  "id": "mon-jeu",
  "name": "Mon jeu",
  "version": "0.1.0",
  "description": "Une phrase, 160 caractères au plus.",
  "author": "Votre nom",
  "engine": { "minVersion": "0.15.0", "api": 1 },
  "entry": { "server": "code/server.js", "client": "code/client.js" },
  "licenses": [{ "path": "licenses/LICENCE.txt", "covers": [] }]
}
```

`id` : minuscules, chiffres et tirets. `version` : X.Y.Z, **écrite à deux endroits** : ici et dans le manifeste de `src/server.ts`. Les deux doivent être identiques : `pack` le vérifie et refuse sinon. La liste `files` et la `signature` sont ajoutées par `pack`.

### Module serveur (src/server.ts)

Le module reprend le contrat `GameModule` de `@partyhub/shared`. Les méthodes obligatoires sont : `manifest`, `settingsSchema`, `defaultSettings`, `actions`, `initialize`, `start`, `handleAction`, `onTimer`, `nextRound`, `calculateScores`, `end`, `getPublicState`, `getPlayerState`, `getHostState`, `isFinished`. `onPlayerJoin`, `onPlayerLeave` et `suggest` (les robots du mode test) sont facultatifs mais recommandés.

Points à respecter :

- Une partie doit toujours se terminer. Le contrôle échoue si elle reste bloquée ou dépasse 3 000 pas.
- Le contrôle rejoue chaque partie, et joue plusieurs parties en alternance dans le même isolat. Une partie qui ne se reproduit pas à l'identique, ou qui change quand elle partage le module avec une autre, est refusée : c'est le signe d'un état gardé hors de la partie, ou de `Date.now()` ou `Math.random()` (utiliser `ctx.now()` et `ctx.random()`).
- `getPublicState`, `getHostState` et `getPlayerState` ne doivent jamais révéler ce qu'un joueur n'a pas le droit de voir (un choix secret, une réponse avant la révélation).
- Le hasard passe par `ctx.random()`, le temps par `ctx.now()`, les minuteurs par `ctx.schedule` et `ctx.cancel`. Les règles restent ainsi reproductibles.
- **Aucun état hors de la partie.** Un même isolat sert toutes les salles d'un jeu : une variable du module modifiée d'un appel à l'autre mélangerait les salles. Tout l'état vit dans l'objet de partie.
- Le module ne touche ni au réseau, ni aux fichiers, ni aux variables d'environnement : l'isolat n'en a pas.

Le modèle (`templates/code-game` dans `packages/server`) est un jeu complet, « pile ou face », qui sert d'exemple.

### Vues (src/client.tsx)

Trois composants, exportés par défaut dans un objet `{ Settings, Host, Player }` :

- `Settings` reçoit `settings`, `disabled` et `onChange` (réglages du salon) ;
- `Host` reçoit `publicState` et `hostState` (écran principal) ;
- `Player` reçoit `publicState`, `playerState` et `send(type, payload)` (téléphone).

`send` renvoie `{ ok, error }`. Les vues ne doivent pas avoir d'effet hors de l'écran. Un jeu désactivé ne sert plus ses vues (réponse 404).

## Signature, confiance et revue

- `keygen` crée une paire Ed25519 : `<préfixe>.key.pem` (privée) et `<préfixe>.pub.pem` (publique). L'identifiant de clé est dérivé de la clé publique.
- `pack` avec une clé privée signe le manifeste entier, donc aussi l'empreinte de chaque fichier. Modifier un seul octet casse la signature.
- `check` avec une clé publique vérifie que le paquet est signé par cette clé. Sans clé, il vérifie seulement la structure et le signale comme non signé.

### Installer dans PartyHub

1. **Clé de confiance.** PartyHub n'accepte que les paquets signés par une clé qu'il connaît. L'auteur crée sa clé avec `keygen` et dépose la partie publique (`.pub.pem`) dans `DATA_DIR/cles-de-confiance/`, avant le premier paquet signé avec elle. Sans clé de confiance, l'installation est refusée avec un message qui indique ce dossier.
2. **Dépôt.** Le paquet arrive par l'une des trois voies de l'administration :
   - le dossier `DATA_DIR/depot-jeux` : PartyHub le relit toutes les dix secondes, et « Relire le dossier maintenant » le relit tout de suite. Un fichier inchangé n'est pas relu par la relecture automatique. Un fichier refusé (paquet invalide, lien symbolique) est signalé avec sa raison ;
   - « Ajouter un jeu de code » : l'adresse HTTPS du fichier. Seules les adresses HTTPS sont acceptées, sans mot de passe dans l'adresse. Les adresses locales et privées sont refusées, y compris après une redirection : chaque étape est vérifiée avant d'être appelée, cinq redirections au plus. Le nom n'est résolu qu'une fois, et la connexion va à l'adresse vérifiée : un nom qui changerait d'adresse entre-temps n'y change rien. Le certificat doit valoir pour le nom de l'URL. Le téléchargement est limité à 8 Mio et à 20 secondes ;
   - « Paquets de jeux (.phgame) » : téléversement du fichier.

   Dans les trois cas, le paquet passe en attente de revue : il ne change rien au jeu actif.
3. **Revue.** Dans « Jeux de code », ouvrir la revue : fichiers, empreintes, code serveur et code des vues. Cocher la case d'approbation, puis « Approuver et activer ».
4. **Effet.** La version approuvée devient active et apparaît au catalogue. Une nouvelle version approuvée remplace l'ancienne, et les salles en cours de l'ancienne version sont fermées (le nombre est affiché).

Règles d'installation :

- Une archive déjà approuvée, réinstallée à l'identique, ne crée rien de nouveau.
- Une même version avec un contenu différent est refusée : il faut monter la version.
- Une version en attente ne remplace jamais la version active tant qu'elle n'est pas approuvée.
- L'approbation ne réactive pas un jeu désactivé : le message le signale, et il faut le réactiver dans l'administration des jeux. Réactiver un jeu ne demande pas de nouvelle approbation.
- Le contrôle de lancement (deux parties de robots, rejouées) peut prendre plusieurs secondes pour un jeu de cartes. Il rend la main au serveur toutes les 25 étapes : les salles restent servies pendant une installation ou une approbation. Deux demandes simultanées pour une même version ne créent qu'une seule version ; une suppression pendant la revue annule l'approbation.

**Revue par différence.** Quand une version remplace une version active, la revue affiche seulement les lignes modifiées du code serveur et des vues, avec quelques lignes de contexte, depuis la version active. Au-delà de 2 000 modifications, la zone concernée est montrée en bloc (tout retiré, tout ajouté).

## Exécution

- **Module serveur** : dans un isolat V8 séparé (`isolated-vm`). Pas de réseau, pas de système de fichiers, pas de processus, pas d'API Node. Mémoire limitée à 64 Mio, et 2 secondes au plus par appel.
- **Budget de temps.** Un appel trop long est interrompu. Au cinquième dépassement (`CODE_MAX_TIMEOUTS`), ou dès qu'un échec détruit l'isolat (mémoire dépassée), le jeu est arrêté : il passe en « Erreur », ses salles sont fermées, et il reste arrêté jusqu'au prochain rechargement des jeux.
- **Vues** : dans un iframe `sandbox="allow-scripts"`, servi depuis `/api/code-games/<id>/<empreinte>/view.html`. Ce document a sa propre politique : un seul script (celui du même paquet), aucune connexion réseau. La page et la vue échangent uniquement des messages (`postMessage`).
- **Contrôle** (`check`) : passe par le même isolat que la production, pour tester ce qui tournera réellement.
- **Charge.** Chaque version chargée a son isolat : environ 2 Mio de mémoire et une quinzaine de millisecondes à créer, plus la taille de son code. Un contexte par salle, dans un seul isolat, a été mesuré et écarté : environ 0,3 Mio par salle, et une limite de 64 Mio partagée par toutes les salles d'un même jeu, qui atteindrait sa limite vers 200 salles et couperait toutes ses salles d'un coup.

## Tests de bout en bout

`e2e/jeu-de-code/parcours.cjs` installe un jeu dans un serveur de test, l'approuve, puis joue une partie complète dans un navigateur : deux téléphones, trois manches, « Fin de partie ». `e2e/jeu-de-code/editeur.cjs` suit le parcours de l'éditeur à l'écran : création, vérification, puis la consigne de signature hors de PartyHub. Ils ne sont pas lancés par `npm test` ; voir `e2e/jeu-de-code/README.md`.

## Rechargement, révocation et audit

- **Recharger les clés et les jeux** (bouton de l'administration, ou `POST /api/admin/code-games/reload`) relit `DATA_DIR/cles-de-confiance/` et les versions actives, sans redémarrer le serveur.
- **Révoquer une clé** : retirer son fichier `.pub.pem`, puis recharger. Les versions signées par cette clé s'arrêtent, et leurs salles sont fermées. Les autres jeux ne sont pas touchés.
- **Journal.** Chaque action est écrite dans le journal du serveur (`partyhub.log`) : `code_game.installed`, `code_game.approved`, `code_game.removed`, `code_game.reloaded`, `code_game.stopped` (avec la raison), `code_game.drop` (un fichier du dossier de dépôt, avec son résultat) et `code_game.import_url` (le domaine d'une importation par lien, sans son chemin). L'acteur est l'adresse IP de la requête : PartyHub n'a qu'un compte administrateur, protégé par mot de passe.

## Sauvegarde

L'export ZIP des sauvegardes inclut les jeux de code (`code-games.json` et `code-games/<id>/<version>.phgame`). À la restauration, chaque version revient **en attente de revue** : rien ne se réactive d'office. L'administrateur doit la relire et l'approuver à nouveau, et le résumé de restauration le signale.

**Ne sont pas incluses** dans l'export : les brouillons (`DATA_DIR/jeux-en-cours`), les paquets déposés mais pas encore lus (`DATA_DIR/depot-jeux`) et les clés de confiance (`DATA_DIR/cles-de-confiance`). Une fois reçus, les paquets sont dans la sauvegarde. Sur une nouvelle installation, copier aussi `cles-de-confiance` : sans clé de confiance, les jeux de code de la sauvegarde ne se réinstallent pas. Copier `jeux-en-cours` pour garder les brouillons. La clé privée de l'auteur n'est jamais dans PartyHub : elle se garde chez l'auteur. Les brouillons et les clés contiennent du travail en cours ou des secrets : les sauvegarder à part, en lieu sûr.

## Limites actuelles

- **Frontière d'isolation.** L'isolat tourne dans le processus du serveur, ce qui est moins fort qu'un processus séparé. À valider avant d'ouvrir l'installation à des auteurs extérieurs.
- **Installation par l'administration seulement.** Pas encore de magasin ni de galerie pour les jeux de code : le magasin GitHub viendra plus tard. Les voies actuelles sont l'éditeur, le dossier de dépôt, le lien HTTPS et le téléversement.
- **Un isolat par jeu, partagé entre les salles.** D'où la règle : aucun état hors de la partie (voir plus haut). Un contexte par salle est reporté : il demande un point de fermeture des salles et une mesure de mémoire.
- **Pas d'images ni de sons à l'exécution** pour les jeux de code. Les fichiers de `assets/` sont dans le paquet, mais les vues ne les affichent pas encore.
- **Taille.** L'archive est limitée à 8 Mio, la limite du format. Aucun autre plafond n'est fixé pour l'instant : à confirmer.
- **Historique.** L'administration relit, approuve et supprime une version ; elle ne gère pas encore l'historique complet des versions.
- **Horloge.** Le contrôle ne repère un jeu qui lit l'horloge réelle (`Date.now()`) que si la valeur change entre deux parties, ce qui n'est pas garanti quand elles tournent dans la même milliseconde. Le jeu doit utiliser `ctx.now()`.
- **Éditeur** : seuls les brouillons créés dans l'administration se modifient ; un paquet reçu d'ailleurs ne se modifie pas. Pas encore de téléversement d'images ni de sons dans l'éditeur. Pas de signature dans PartyHub : c'est volontaire, la clé reste chez l'auteur.
- **Docker non vérifié** : l'image PartyHub unique, et donc l'éditeur dans cette image, n'ont pas été construits dans l'environnement de développement (voir plus haut).
