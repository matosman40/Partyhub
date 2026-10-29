# Personnages illustrés (packs de sprites)

Un **personnage illustré** (pack) est fait de planches d'images (PNG) que l'administration importe depuis un zip.
Une fois importé, il apparaît dans le choix du personnage du profil, à côté du personnage dessiné.
Le personnage s'affiche partout où il apparaît : profil, avatars, salle et plateau.

Un personnage peut avoir **plusieurs looks** : une même personne avec une autre tenue, une autre coiffure ou un
autre thème (« Standard », « Fête », …). Chaque look est un zip complet, avec ses propres planches. Le profil
permet de choisir le personnage, puis le look (la liste des looks n'apparaît que s'il y en a plusieurs).

## Importer un pack

**Nouveau personnage** : dans l'administration, section **Personnages illustrés (zip)**, laissez la liste
« Ajouter à » sur « Un nouveau personnage ».

1. Choisissez le fichier `.zip`.
2. Vérifiez le **nom du personnage** (proposé d'après le nom du fichier). L'identifiant est dérivé de ce nom
   (« Dewi Sri » → `dewi-sri`) et doit être unique.
3. Donnez un **nom au look** (par défaut « Standard » si vide, à l'import du premier zip).
4. Cochez la case d'accord (voir _Consentement_ ci-dessous). Sans elle, l'import est refusé.
5. Cliquez sur **Importer le personnage**.

**Nouveau look pour un personnage existant** : dans « Ajouter à », choisissez « Un look de … ». Le nom du
personnage n'est plus demandé. Donnez le nom du look (obligatoire, par exemple « Fête »), choisissez le zip, cochez
l'accord, puis cliquez sur **Ajouter le look**. Un look doit porter un nom différent de ceux déjà présents.

**Retirer un look** : la liste « Personnages importés » montre chaque look avec **Retirer ce look**. Retirer le
dernier look supprime aussi le personnage.

En cas d'erreur, la liste des problèmes s'affiche sous le formulaire. Rien n'est enregistré tant que le pack
n'est pas entièrement valide.

Limites : zip de 8 Mo au plus, 60 fichiers au plus, image PNG de 2 Mo au plus, JSON de 256 Ko au plus.
Les dossiers créés par Finder ou l'Explorateur sont acceptés. Les autres fichiers du zip (sources, aperçus,
script, README) sont ignorés.

## Format du zip

La racine peut être un dossier. Les fichiers reconnus sont :

| Fichier                                    | Rôle                                         | Obligatoire                |
| ------------------------------------------ | -------------------------------------------- | -------------------------- |
| `json/visages.json` et `atlas/visages.png` | portraits (avatars)                          | oui, avec la case `neutre` |
| `json/poses.json` et `atlas/poses.png`     | corps entier (salle, éditeur)                | oui, avec la case `repos`  |
| `json/marche.json` et `atlas/marche.png`   | marche (réservé, non affiché pour l'instant) | non                        |

Chaque fichier `json/<planche>.json` décrit la planche :

```json
{
  "cellule": { "w": 67, "h": 70 },
  "colonnes": 4,
  "lignes": 2,
  "images": [{ "nom": "neutre", "x": 0, "y": 0, "w": 67, "h": 70, "pivot": { "x": 33, "y": 68 } }]
}
```

- Toutes les cases d'une planche ont la même taille (`cellule`).
- La planche doit faire exactement `cellule.w × colonnes` par `cellule.h × lignes` pixels, comme le PNG.
- Chaque case (`x`, `y`, `w`, `h`) doit tenir dans l'image. Les noms (`nom`) sont uniques dans une planche :
  lettres minuscules, chiffres et `_`, 30 caractères au plus.
- `pivot` est facultatif (sinon, centre horizontal et bas de la case).

Le script `script/normaliser.py` du pack Dewi Sri produit ce format.

## Attitudes et cases

L'attitude du personnage choisit la case affichée. Si une case manque, la case par défaut de la planche est utilisée.

| Attitude | Portrait (`visages`) | Corps entier (`poses`) |
| -------- | -------------------- | ---------------------- |
| Repos    | `neutre`             | `repos`                |
| Joie     | `tres_joyeuse`       | `joie`                 |
| Triste   | `triste`             | `triste`               |
| Salut    | `clin_doeil`         | `coucou`               |
| Danse    | `contente`           | `victoire`             |

## Consentement

Les sprites sont souvent faits à partir d'une photo de personne. L'import exige donc la case
« Je confirme que la personne représentée a donné son accord… ». Cette case engage l'administrateur :
il doit avoir l'accord de la personne avant d'importer le pack. C'est la même règle que pour les photos de
profil, qui ne sont montrées aux autres joueurs qu'après un accord explicite. Le README du pack Dewi Sri
indique lui-même cette exigence.

## Suppression

Supprimer un personnage (et tous ses looks) le retire du choix des profils. Un joueur qui l'avait choisi retrouve
son personnage dessiné, sans erreur. Retirer un seul look ne touche que ce look : un joueur qui l'avait choisi
retombe sur le premier look restant du personnage.

## Dans le profil

Le profil propose d'abord le personnage (dessiné ou illustré). Si le personnage illustré a plusieurs looks, une
seconde ligne **Look** apparaît pour choisir le look. Le choix est enregistré avec le profil.

## Créer depuis une photo

Dans l'éditeur de personnage du profil, le bouton **Créer depuis une photo** crée un personnage à partir d'une photo
de votre visage : teint, coiffure, couleur de cheveux, accessoire et expression sont choisis dans les listes de
PartyHub, et la couleur du corps est conservée. Le bouton n'apparaît que si le serveur propose la fonction
(`GET /api/features`, champ `portrait`). Il faut être connecté à son profil et cocher l'accord : pour un enfant, celui
d'un parent est nécessaire.

Confidentialité : le navigateur réduit la photo (768 px) et la réencode, ce qui supprime les métadonnées, dont la
position GPS. Le serveur la transmet à Cloudflare Workers AI, qui ne répond que par des valeurs fixes. La photo n'est
ni enregistrée, ni journalisée, ni sauvegardée : seul le personnage est gardé, et aucun texte libre n'entre en base.
Un seul visage est accepté. Activation et plafond : `PORTRAIT_ENABLED` et `PORTRAIT_MAX_PER_DAY` (voir le README).

## Dans le code

- Validation et stockage : `packages/server/src/characters/packs.ts` (zip lu par `packages/server/src/packages/zip.ts`).
- Stockage SQLite : tables `character_packs`, `character_looks` et `character_look_files` (migration 10).
- Routes : `GET /api/character-packs` (liste avec les looks),
  `GET /api/character-packs/:id/looks/:look/atlas/:planche.png` (image),
  `POST /api/admin/character-packs?nom=…&look=…&confirme=1` (nouveau personnage, zip brut),
  `POST /api/admin/character-packs?pack=:id&look=…&confirme=1` (nouveau look pour un personnage existant),
  `DELETE /api/admin/character-packs/:id/looks/:look` (retirer un look),
  `DELETE /api/admin/character-packs/:id` (retirer le personnage).
- Affichage : `packages/games/src/client/character-pack-figure.tsx` (découpe de la case par un viewBox SVG) et
  `character.tsx` (point d'entrée `Character`, qui choisit le sprite ou le personnage dessiné).
- Choix dans le profil : `packages/web/src/profile/CharacterEditor.tsx`.
