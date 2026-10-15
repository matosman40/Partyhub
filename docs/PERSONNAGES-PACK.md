# Personnages illustrés (packs de sprites)

Un **pack** est un personnage fait de planches d'images (PNG) que l'administration importe depuis un zip.
Une fois importé, il apparaît dans le choix du personnage du profil, à côté du personnage dessiné.
Le pack s'affiche partout où le personnage apparaît : profil, avatars, salle et plateau.

## Importer un pack

1. Dans l'administration, section **Personnages illustrés (zip)**, choisissez le fichier `.zip`.
2. Vérifiez le **nom affiché** (proposé d'après le nom du fichier). L'identifiant est dérivé de ce nom
   (« Dewi Sri » → `dewi-sri`) et doit être unique.
3. Cochez la case d'accord (voir _Consentement_ ci-dessous). Sans elle, l'import est refusé.
4. Cliquez sur **Importer le personnage**.

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

Supprimer un pack le retire du choix des profils. Un joueur qui l'avait choisi retrouve son personnage dessiné,
sans erreur.

## Dans le code

- Validation et stockage : `packages/server/src/characters/packs.ts` (zip lu par `packages/server/src/packages/zip.ts`).
- Stockage SQLite : tables `character_packs` et `character_pack_files` (migration 10).
- Routes : `GET /api/character-packs` (liste), `GET /api/character-packs/:id/atlas/:planche.png` (image),
  `POST /api/admin/character-packs?nom=…&confirme=1` (import, zip brut), `DELETE /api/admin/character-packs/:id`.
- Affichage : `packages/games/src/client/character-pack-figure.tsx` (découpe de la case par un viewBox SVG) et
  `character.tsx` (point d'entrée `Character`, qui choisit le sprite ou le personnage dessiné).
- Choix dans le profil : `packages/web/src/profile/CharacterEditor.tsx`.
