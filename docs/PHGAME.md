# Paquets de jeux `.phgame`

Un paquet `.phgame` contient un jeu complet dans un seul fichier : la définition, les ressources graphiques, les données
et les licences. Il s'installe depuis l'administration de PartyHub, sans accès à internet ni compilation, et se vérifie
avant toute installation.

## Trois types de jeux, trois niveaux de prise en charge

| Type | Contenu | État |
|---|---|---|
| **Déclaratif** | Des données seulement, rendues par le moteur de PartyHub : jeu de cartes, jeu de plateau, jeu de questions (liens YouTube), recette (règles d'une famille connue, avec écrans et IA optionnelle). | **Disponible** : cartes depuis 0.5.0, plateau et questions depuis 0.7.0 (format 2), recettes depuis 0.12.0 (format 3). |
| **JavaScript** | Du code de jeu exécuté dans un bac à sable séparé du serveur. | **Non implémenté.** Prévu dans la feuille de route (`docs/ROADMAP.md`). |
| **Émulation rétro** | Ressources et code d'une console ou d'un ordinateur ancien. | **Non pris en charge.** Hors périmètre. |

Aucun code fourni dans un paquet n'est exécuté par le serveur aujourd'hui. Un paquet déclaratif ne contient que des données
qui sont lues et validées, jamais interprétées comme du programme.

## Structure de l'archive

```
exemple-cartes.phgame        (archive ZIP)
├── manifest.json            manifeste, à la racine
├── game/
│   └── definition.json      définition du jeu (même format que les jeux de cartes de l'administration)
├── assets/                  images facultatives : .png, .jpg, .jpeg, .webp
├── data/                    données JSON facultatives
└── licenses/                licences et attributions : .txt, .md
```

Le manifeste déclare chaque fichier de l'archive avec sa taille et son empreinte SHA-256 :

```json
{
  "format": "phgame",
  "formatVersion": 1,
  "id": "exemple-cartes",
  "name": "Exemple de jeu de cartes",
  "version": "1.0.0",
  "description": "Jeu de démonstration fourni avec PartyHub.",
  "author": "PartyHub contributors",
  "kind": "declarative",
  "engine": { "minVersion": "0.5.0", "api": 1 },
  "requires": { "modules": ["cards"] },
  "entry": "game/definition.json",
  "licenses": [{ "path": "licenses/LICENCE.txt", "covers": [] }],
  "files": [
    { "path": "game/definition.json", "size": 1200, "sha256": "…" },
    { "path": "licenses/LICENCE.txt", "size": 140, "sha256": "…" }
  ]
}
```

Le champ `files` est calculé par la commande `pack` : il n'est pas à remplir à la main.

## Formats et modules

Chaque paquet porte **exactement un module de jeu**, déclaré dans `requires.modules`. Le module détermine le schéma de
`game/definition.json`, la catégorie du jeu et les vues utilisées.

| Format | Modules admis | Version du moteur |
|---|---|---|
| `formatVersion: 1` | `cards` | 0.5.0 et suivantes |
| `formatVersion: 2` | `cards`, `board`, `quiz` | 0.7.0 et suivantes |
| `formatVersion: 3` | `recipe` | 0.12.0 et suivantes |

| Module | Définition | Catégorie | Contraintes |
|---|---|---|---|
| `cards` | Jeu de cartes (familles, cartes, effets, règles) | cartes | Pas de dos ni de police de la médiathèque. |
| `board` | Plateau de 8 à 60 cases, dés, règles, effets des cases | plateau | Première case normale, dernière case d'arrivée. Aucune ressource externe. |
| `quiz` | Extraits à reconnaître, réponses, durée, mode | quiz | Vidéo **YouTube seulement** : identifiant et plage de lecture. Aucun fichier de la médiathèque. |
| `recipe` | Recette (voir la section suivante) : règles, consignes, écrans, IA facultative | quiz | Format 3. Une recette ne contient aucun code. |

Exemple de manifeste pour un plateau (format 2) :

```json
{
  "format": "phgame",
  "formatVersion": 2,
  "id": "mon-plateau",
  "name": "Mon plateau",
  "version": "1.0.0",
  "description": "Un parcours de 14 cases.",
  "author": "Votre nom",
  "kind": "declarative",
  "engine": { "minVersion": "0.7.0", "api": 1 },
  "requires": { "modules": ["board"] },
  "entry": "game/definition.json",
  "licenses": [{ "path": "licenses/LICENCE.txt", "covers": [] }],
  "files": []
}
```

Les exemples fournis : `examples/exemple-plateau/` et `examples/exemple-quiz/` (identifiants YouTube à remplacer), à côté de
`examples/exemple-cartes/`. Chaque paquet d'exemple pèse environ 1,4 Ko : un plateau ou une liste de questions tient dans un
paquet très léger. Le poids d'un paquet vient surtout de ses images : un jeu sans image reste minuscule.

Un identifiant de jeu dépend du module : `pkg-` pour les cartes, `pkgb-` pour les plateaux, `pkgq-` pour les questions,
`pkgr-` pour les recettes. Un paquet de plateau et un paquet de cartes ne peuvent donc jamais partager le même identifiant de
jeu. Une mise à jour qui change le module d'un paquet installé est refusée : il faut un autre identifiant.

## Recettes (format 3)

Une recette décrit un jeu avec les règles déjà connues du moteur. Le paquet fournit les textes, les règles, la disposition des
écrans et, si on le souhaite, des consignes écrites par l'IA. Aujourd'hui, une seule recette existe : `vote-sur-consigne`
(chacun écrit un mot pour une consigne, puis tout le monde vote pour le plus drôle, sans savoir qui l'a écrit).

Exemple complet : `examples/exemple-recette/` (1,4 Ko). Le manifeste déclare `"formatVersion": 3`, `"requires": { "modules": ["recipe"] }`
et `"engine": { "minVersion": "0.12.0", "api": 1 }`. La définition, `game/definition.json` :

```json
{
  "recipe": "vote-sur-consigne",
  "name": "Le plus…",
  "description": "Écrivez le premier mot qui vous vient, puis votez pour le plus drôle.",
  "icon": "💭",
  "rules": { "manches": 4, "ecriture": 40, "vote": 25, "pointsParVote": 100, "motMax": 24 },
  "consignes": ["Le plus susceptible d’oublier son téléphone en vacances", "Le plus bruyant au cinéma"],
  "ecrans": {
    "tv": { "ecriture": ["consigne", "minuteur", "attente"] },
    "joueur": { "ecriture": ["consigne", "saisie-texte", "minuteur"] }
  }
}
```

- **`rules`** : toutes les valeurs sont facultatives. `manches` (1 à 10), `ecriture` et `vote` en secondes, `pointsParVote`
  (0 à 500), `motMax` (4 à 40 caractères).
- **`consignes`** : au moins une consigne, 90 caractères au plus chacune, 100 au plus. Elles tirent au sort les manches.
- **`ai`** (facultatif) : `{ "theme": "années 80", "nombre": 6, "consigne": "…" }`. Quand un fournisseur d'IA est configuré,
  la partie commence par la génération de consignes sur ce thème. La réponse est validée consigne par consigne ; sans assez de
  consignes valides, ou sans fournisseur, le jeu prend la liste `consignes` et l'écran l'indique. Le modèle de consigne peut
  contenir `{{theme}}` et `{{nombre}}`.
- **`ecrans`** (facultatif) : pour chaque écran (`tv` ou `joueur`) et chaque phase (`pret`, `generation`, `ecriture`, `vote`,
  `resultat`, `final`), la liste des blocs à afficher, dans l'ordre. Sans cette liste, la disposition par défaut sert.
  Blocs admis : `titre`, `consigne`, `minuteur`, `attente`, `saisie-texte`, `vote`, `resultat`, `classement`. Un bloc ne
  s'affiche que là où il a un sens (`saisie-texte` seulement sur le téléphone, pendant l'écriture). Une autre place fait refuser
  le paquet, avec le chemin exact du bloc.
- **`appareils`** (facultatif) : besoins déclarés, `camera`, `micro`, `mouvement`, `vibreur`, `qr`, chacun `requis` ou
  `facultatif`. Ils sont validés, mais aucune recette actuelle n'utilise d'appareil : ils seront exploités avec les blocs de
  photo, de son et de capteurs.

La définition est stricte : une clé inconnue fait refuser le paquet, pour qu'une faute de frappe ne soit jamais ignorée en
silence. Les écrans, les textes et les règles d'une recette sont donc tous décrits dans le paquet ; aucun code n'est exécuté.

**Limites actuelles des recettes** : pas de copie modifiable dans l'administration (une recette reste un paquet) ; les
consignes de l'IA viennent du thème de l'auteur, pas des mots des joueurs ; pas de script (prévu après revue de sécurité).

## Règles de validation

Un paquet est refusé dès qu'une règle n'est pas respectée. Les anomalies du contenu sont toutes affichées ; une archive mal formée est refusée au premier problème rencontré.

- **Archive** : ZIP standard uniquement. Refusés : chiffrement, compression autre que « stockée » ou « deflate », liens
  symboliques, entrées en double, archives multi-volumes, dossiers vides ou répertoires inattendus.
- **Taille et compression** : 8 Mio au plus pour le fichier, 200 entrées au plus, 4 Mio par fichier, 32 Mio au total,
  et un taux de compression limité à 100 pour se protéger des archives piégées. Budgets par élément : manifeste 8 Ko,
  définition 256 Ko, image 200 Ko.
- **Chemins** : relatifs, sans `..`, sans caractère interdit, quatre niveaux au plus. Seuls les dossiers `game/`, `assets/`,
  `data/` et `licenses/` sont admis, avec leurs extensions.
- **Manifeste** : JSON strict. Une clé inconnue est une erreur. Identifiant en minuscules, version au format `X.Y.Z`.
  Un paquet de format 3 demande un moteur 0.12.0 au minimum, et seule une recette peut utiliser ce format.
- **Empreintes** : chaque fichier de l'archive doit être déclaré, avec la bonne taille et le bon SHA-256. Un fichier
  déclaré mais absent, ou présent mais non déclaré, est refusé.
- **Moteur** : la version minimale du moteur doit être égale ou inférieure à celle du serveur, et l'API doit être `1`.
- **Licences** : chaque ressource de `assets/` doit être couverte par une licence ou une attribution listée dans le manifeste.
- **Images** : la signature doit correspondre à l'extension. Pour les PNG, les côtés ne dépassent pas 1024 px, et chaque image
  pèse 200 Ko au plus (les JPEG et WebP sont contrôlés sur leur signature et leur poids).
- **Définition** : `game/definition.json` est validé avec les mêmes règles que les jeux créés dans l'administration, selon le
  module (cartes, plateau ou questions). Un paquet de questions ne peut référencer que des vidéos YouTube.
- **Module** : exactement un module par paquet, admis par le format (version 1 : cartes seulement ; version 3 : recettes seulement).
- **Lancement de contrôle** : avant installation, deux parties complètes sont jouées par des robots. Un jeu qui ne démarre pas,
  qui refuse une action légale, qui reste bloqué ou dont les vues ne se sérialisent pas est refusé.

## Installer un paquet

### Depuis l'administration

Dans l'administration, section **Paquets de jeux (.phgame)** : importer le fichier. Le jeu apparaît ensuite dans le catalogue,
avec le préfixe `pkg-` dans son identifiant. Un paquet peut être désactivé (ses salles en cours sont fermées) ou supprimé.

### En ligne de commande

Depuis le dossier `packages/server` du dépôt, après `npm run build` :

```bash
# Construire un paquet à partir d'un dossier source (le dossier doit contenir manifest.json).
npm run phgame -- pack ../../examples/exemple-cartes ../../examples/exemple-cartes.phgame

# Vérifier un paquet et lancer la partie de contrôle.
npm run phgame -- check ../../examples/exemple-cartes.phgame
```

Le paquet d'exemple est reconstruit à l'identique par la commande `pack` : la CI vérifie que le fichier committé correspond
à son dossier source.

## Copier un paquet pour le modifier

Un paquet installé reste tel quel : c'est ce qui permet de le mettre à jour. Pour changer son nom, sa description, ses cartes,
ses cases, ses questions ou ses règles, cliquez sur **Créer une copie modifiable** dans la section des paquets.

- La copie est un jeu de l'administration, avec la même définition que le paquet. Elle s'édite dans l'éditeur de son type :
  jeux de cartes, jeux de plateau ou jeux de questions médias. Son nom porte le suffixe « (copie) ».
- Le paquet d'origine reste installé et inchangé.
- La copie garde le lien avec son paquet. La section des paquets indique si elle a été modifiée, et si le paquet a une
  version plus récente. **Mettre la copie à jour** la remplace par cette version : son nom est conservé. Une copie
  modifiée demande une confirmation, car ses modifications sont perdues.
- Si le paquet d'origine est supprimé, la copie reste modifiable mais ne reçoit plus de mises à jour.
- Seul un paquet actif peut être copié.

## Mise à jour et retour arrière

- Un paquet de même identifiant et de version plus récente devient la version jouée. L'ancienne version est conservée,
  et l'état d'activation du jeu est gardé.
- Une version plus ancienne est importée sans être jouée : elle est conservée à côté de la version active.
- Dans l'administration, le bouton « Versions » liste les versions d'un paquet (la jouée et les conservées). « Jouer
  cette version » bascule sur une version conservée : c'est le retour arrière. Une archive altérée n'est jamais jouée.
- Une version identique au contenu déjà connu est reconnue sans être réécrite.
- Une version déjà connue avec un contenu différent est refusée : il faut augmenter le numéro de version.
- Supprimer un paquet supprime toutes ses versions conservées.
- Les versions conservées occupent de la place sur le disque : quelques kilo-octets pour un jeu courant.

## Où sont stockés les paquets

Chaque archive vérifiée est conservée dans `DATA_DIR/games/<identifiant>/<version>/package.phgame`. Au démarrage, chaque archive
est revalidée et son empreinte comparée à celle de la base. Une archive modifiée à la main passe en état **Erreur** et son
jeu n'est pas proposé.

La sauvegarde complète de PartyHub (fichier JSON de l'administration) ne contient pas les fichiers des paquets : sauvegardez
aussi le dossier `DATA_DIR/games/`, ou conservez les fichiers `.phgame` d'origine.

## Ressources graphiques

Les images d'un paquet actif sont servies par `GET /api/packages/<identifiant>/assets/<chemin>`, avec un type MIME selon
l'extension et l'en-tête `X-Content-Type-Options: nosniff`. Une ressource d'un paquet désactivé ou en erreur renvoie 404.
Les vues de cartes n'affichent pas encore ces images : elles utilisent l'icône et les couleurs de la définition.

## Sources GitHub (0.6.3)

Un paquet peut être installé et mis à jour depuis la dernière release d'un dépôt GitHub, au lieu d'être importé à la main.
Dans l'administration, section **Sources GitHub** : indiquer `auteur/nom`.

- Le serveur lit la **dernière release publiée** (les brouillons et préversions sont ignorés).
- La release doit contenir **un seul** fichier `.phgame` et son fichier `.sha256` (nom : `<fichier>.phgame.sha256`).
  Le fichier `.sha256` contient l'empreinte SHA-256 du paquet, au format `sha256sum`.
- Le numéro de version du tag (`v1.2.0` ou `1.2.0`) doit être égal à la version du manifeste.
- Le fichier est refusé si son empreinte ne correspond pas, si la version ne correspond pas au tag, ou si un paquet de même
  identifiant est déjà installé sans être lié à ce dépôt.
- **Une seule version par jeu** est installée : la mise à jour remplace l'ancienne, avec les mêmes règles que l'import
  manuel (pas de retour arrière, contenu identique reconnu).
- Mise à jour **à la demande** (« Vérifier et mettre à jour ») ou **automatique** une fois par jour pour les sources qui l'ont activée.
- Un dépôt privé demande la variable `GITHUB_TOKEN` du serveur. Le jeton n'est jamais affiché, ni journalisé, ni sauvegardé.
- **Dépôt commun** : indiquez `auteur/depot/jeu`. Le dépôt contient plusieurs jeux ; chaque version est un tag
  `<jeu>-vX.Y.Z`, et la release contient `<jeu>.phgame` et `<jeu>.phgame.sha256`. PartyHub retient la version la plus haute
  de ce jeu, sans toucher aux autres. Le dépôt `matosman40/jeux-partyhub` est organisé ainsi.
- Supprimer une source laisse le paquet installé, mais il ne se met plus à jour.
- Le serveur doit pouvoir joindre GitHub. Seuls les hôtes GitHub sont autorisés, y compris lors des redirections.

Le modèle de publication pour un dépôt de jeu est décrit dans [PUBLIER-UN-JEU.md](PUBLIER-UN-JEU.md).

## Ce qui n'est pas encore inclus

- Scripts JavaScript dans un paquet : prévus pour la version 1.1, après une revue de sécurité. Les recettes couvrent les
  jeux de texte et de vote ; les jeux à règles libres restent du code intégré en attendant.
- Blocs d'écran de capteurs, de photo et de son dans les recettes : ajoutés avec les recettes qui en ont besoin.
- Cache hors ligne et lancement sans réseau des paquets installés : prévus avec l'application installable (version 0.7.0).
- Transfert d'un paquet entre téléphones : prévu avec la reprise d'écran (version 0.7.0).
- Jeux JavaScript dans un bac à sable : prévus dans une version ultérieure (voir la feuille de route).
- Jeux de temps réel et de mouvement (type Bomberman, Just Dance) : pas dans un paquet. Un paquet ne porte que des données ;
  ces mécaniques restent du code intégré à PartyHub, ou demanderont le bac à sable JavaScript.
- Vidéos et sons de la médiathèque dans un paquet : non pris en charge. Les questions utilisent des liens YouTube.
