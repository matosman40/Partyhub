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

## Dans le code

- Validation et stockage : `packages/server/src/characters/packs.ts` (zip lu par `packages/server/src/packages/zip.ts`).
- Stockage en fichiers, dans `PERSONNAGES_DIR` (par défaut `DATA_DIR/personnages`) : `packs/<id>/pack.json` (nom et
  looks), puis un dossier par look, `packs/<id>/<look>/`, avec ses planches PNG. Les images de la bibliothèque sont dans
  `images/`. Sous Docker, c'est `/contenu/personnages` du volume `partyhub-contenu`.
- Au premier démarrage, les personnages et images qui étaient encore dans la base SQLite sont déplacés vers ces fichiers,
  puis retirés de la base. Une ligne n'est retirée qu'une fois son fichier écrit, et un redémarrage ne refait rien.
- La sauvegarde de la base seule (SQLite) ne contient ni les personnages ni les images. La sauvegarde complète (archive)
  les inclut.
- Routes : `GET /api/character-packs` (liste avec les looks),
  `GET /api/character-packs/:id/looks/:look/atlas/:planche.png` (image),
  `POST /api/admin/character-packs?nom=…&look=…&confirme=1` (nouveau personnage, zip brut),
  `POST /api/admin/character-packs?pack=:id&look=…&confirme=1` (nouveau look pour un personnage existant),
  `DELETE /api/admin/character-packs/:id/looks/:look` (retirer un look),
  `DELETE /api/admin/character-packs/:id` (retirer le personnage).
- Affichage : `packages/games/src/client/character-pack-figure.tsx` (découpe de la case par un viewBox SVG) et
  `character.tsx` (point d'entrée `Character`, qui choisit le sprite ou le personnage dessiné).
- Choix dans le profil : `packages/web/src/profile/CharacterEditor.tsx`.
