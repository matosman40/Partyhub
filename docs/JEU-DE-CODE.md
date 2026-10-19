# Jeux de code (format 5) : créer, construire, signer, contrôler

**Statut : prototype.** Un jeu de code se crée, se construit, se signe et se contrôle avec les outils ci-dessous. En revanche, PartyHub **n'installe pas encore** ces paquets : la voie d'installation refuse explicitement un paquet de code (« pas encore installable »). L'exécution isolée du code sur le serveur n'existe pas encore : elle est décrite dans les limites en fin de document.

Un jeu de code est un paquet `.phgame` (format 5) qui contient le code compilé du jeu : un module serveur (les règles) et des vues pour l'écran principal, le téléphone et les réglages.

Pour créer un jeu avec un assistant IA, utiliser le prompt de `docs/PROMPT-JEU-DE-CODE.md`.

## Créer un jeu avec Docker

Aucune installation de Node n'est nécessaire. Depuis la racine du dépôt :

```bash
# 1. Créer un jeu depuis le modèle (dans ./jeux-en-cours/mon-jeu)
docker compose -f compose.dev.yaml run --rm jeux new /jeu/mon-jeu mon-jeu "Mon jeu" "Votre nom"

# 2. Créer les clés de signature (une fois ; la clé privée reste dans ./cles, jamais dans le dépôt)
docker compose -f compose.dev.yaml run --rm jeux keygen /cles/mon-jeu

# 3. Construire et signer le paquet
docker compose -f compose.dev.yaml run --rm jeux pack /jeu/mon-jeu /jeu/mon-jeu.phgame /cles/mon-jeu.key.pem

# 4. Contrôler : structure, signature, syntaxe, puis une partie complète jouée par des robots
docker compose -f compose.dev.yaml run --rm jeux check /jeu/mon-jeu.phgame /cles/mon-jeu.pub.pem
```

Le service `jeux` n'a **pas de réseau** (`network_mode: none`) : le code du jeu ne peut ni joindre internet ni lire autre chose que le dossier monté.

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

`id` : minuscules, chiffres et tirets. `version` : X.Y.Z. La liste `files` et la `signature` sont ajoutées par `pack`.

### Module serveur (src/server.ts)

Le module reprend le contrat `GameModule` de `@partyhub/shared`. Les méthodes obligatoires sont : `manifest`, `settingsSchema`, `defaultSettings`, `actions`, `initialize`, `start`, `handleAction`, `onTimer`, `nextRound`, `calculateScores`, `end`, `getPublicState`, `getPlayerState`, `getHostState`, `isFinished`. `onPlayerJoin`, `onPlayerLeave` et `suggest` (les robots du mode test) sont facultatifs mais recommandés.

Points à respecter :

- Une partie doit toujours se terminer. Le contrôle échoue si elle reste bloquée ou dépasse 3 000 pas.
- `getPublicState`, `getHostState` et `getPlayerState` ne doivent jamais révéler ce qu'un joueur n'a pas le droit de voir (un choix secret, une réponse avant la révélation).
- Le hasard passe par `ctx.random()`, le temps par `ctx.now()`, les minuteurs par `ctx.schedule` et `ctx.cancel`. Les règles restent ainsi reproductibles.
- Le module ne touche ni au réseau, ni aux fichiers, ni aux variables d'environnement.

Le modèle (`templates/code-game` dans `packages/server`) est un jeu complet, « pile ou face », qui sert d'exemple.

### Vues (src/client.tsx)

Trois composants, exportés par défaut dans un objet `{ Settings, Host, Player }` :

- `Settings` reçoit `settings`, `disabled` et `onChange` (réglages du salon) ;
- `Host` reçoit `publicState` et `hostState` (écran principal) ;
- `Player` reçoit `publicState`, `playerState` et `send(type, payload)` (téléphone).

`send` renvoie `{ ok, error }`. Les vues ne doivent pas avoir d'effet hors de l'écran.

## Signature et confiance

- `keygen` crée une paire Ed25519 : `<préfixe>.key.pem` (privée) et `<préfixe>.pub.pem` (publique). L'identifiant de clé est dérivé de la clé publique.
- `pack` avec une clé privée signe le manifeste entier, donc aussi l'empreinte de chaque fichier. Modifier un seul octet casse la signature.
- `check` avec une clé publique vérifie que le paquet est signé par cette clé. Sans clé, il vérifie seulement la structure et le signale comme non signé.

Décision validée : un jeu de code est signé, puis relu par l'administrateur avant activation. Ces deux étapes ne sont pas encore branchées dans PartyHub.

## Limites actuelles

- **Pas encore installable.** Un paquet de code est refusé par la voie d'installation, avec un message explicite.
- **Pas d'isolation côté serveur.** Le contrôle exécute le code sur le poste du développeur (ou dans le conteneur `jeux`, sans réseau). Le serveur de production ne l'exécute pas.
- **Pas de contrôle de taille propre aux jeux de code.** Les budgets du format existant s'appliquent : archive de 8 Mio au plus, images et sons selon leurs limites actuelles.
- **Vues non isolées.** Les vues seront exécutées dans une iframe sandboxée au moment de l'installation ; ce n'est pas encore le cas.
