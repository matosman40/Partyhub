# Paquets de jeux `.phgame`

Un paquet `.phgame` contient un jeu complet dans un seul fichier : la définition, les ressources graphiques, les données
et les licences. Il s'installe depuis l'administration de PartyHub, sans accès à internet ni compilation, et se vérifie
avant toute installation.

## Trois types de jeux, trois niveaux de prise en charge

| Type | Contenu | État |
|---|---|---|
| **Déclaratif** | Des données seulement : un jeu de cartes décrit en JSON, rendu par le moteur de PartyHub. | **Disponible** (version 0.5.0). |
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

## Règles de validation

Un paquet est refusé dès qu'une règle n'est pas respectée. Les anomalies du contenu sont toutes affichées ; une archive mal formée est refusée au premier problème rencontré.

- **Archive** : ZIP standard uniquement. Refusés : chiffrement, compression autre que « stockée » ou « deflate », liens
  symboliques, entrées en double, archives multi-volumes, dossiers vides ou répertoires inattendus.
- **Taille et compression** : 16 Mio au plus pour le fichier, 200 entrées au plus, 4 Mio par fichier, 32 Mio au total,
  et un taux de compression limité à 100 pour se protéger des archives piégées.
- **Chemins** : relatifs, sans `..`, sans caractère interdit, quatre niveaux au plus. Seuls les dossiers `game/`, `assets/`,
  `data/` et `licenses/` sont admis, avec leurs extensions.
- **Manifeste** : JSON strict. Une clé inconnue est une erreur. Identifiant en minuscules, version au format `X.Y.Z`.
- **Empreintes** : chaque fichier de l'archive doit être déclaré, avec la bonne taille et le bon SHA-256. Un fichier
  déclaré mais absent, ou présent mais non déclaré, est refusé.
- **Moteur** : la version minimale du moteur doit être égale ou inférieure à celle du serveur, et l'API doit être `1`.
- **Licences** : chaque ressource de `assets/` doit être couverte par une licence ou une attribution listée dans le manifeste.
- **Images** : la signature doit correspondre à l'extension. Pour les PNG, les côtés ne dépassent pas 2048 px (les JPEG et WebP sont contrôlés sur leur signature seulement).
- **Définition** : `game/definition.json` est validé avec les mêmes règles que les jeux de cartes créés dans l'administration.
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

## Mise à jour et retour arrière

- Un paquet de même identifiant et de version plus récente remplace l'ancien. L'ancienne version est retirée une fois la
  mise à jour réussie, et l'état d'activation est conservé.
- Une version plus ancienne est refusée. Pour revenir en arrière, supprimez le paquet puis réimportez l'ancien fichier.
- Une version identique avec un contenu différent est refusée : il faut augmenter le numéro de version.

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

## Ce qui n'est pas encore inclus

- Cache hors ligne et lancement sans réseau des paquets installés : prévus avec l'application installable (version 0.7.0).
- Transfert d'un paquet entre téléphones : prévu avec la reprise d'écran (version 0.7.0).
- Jeux JavaScript dans un bac à sable : prévus dans une version ultérieure (voir la feuille de route).
- Jeux de plateau : créés dans l'administration depuis la version 0.6.2, mais pas encore dans un paquet `.phgame`.
