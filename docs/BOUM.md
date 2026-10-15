# BOUM !

Jeu de soirée : des manches tirées au hasard dans un pool de modes (écrire, voter, bluffer, estimer).
Identifiant `boum`, catégorie quiz, de 2 à 12 joueurs.

## État de la livraison

| Partie | État |
| --- | --- |
| Moteur des manches, tirage, barèmes | fait (phase 1) |
| Modes texte, vote et cartes : Réponse rapide, Combien ?, Trous noirs, Main sale, Vrai ou faux, Qui a dit ça ?, Épitaphe, Le pire conseil, Le plus probable, Détecteur de mauvaise foi | fait |
| Pack Humour noir (activé par salle, avec avertissement) | fait |
| Banques de contenu (table, amorce, validation, import et export `.txt`, routes d'administration) | fait |
| Onglet « Banques BOUM » de l'administration (compteurs, filtres, édition, validation en lot, import avec aperçu, export), file « Propositions », « Proposer une carte » dans le profil avec quotas | fait |
| Mime le métier (téléphone : le mimeur voit le métier sur son seul téléphone, les autres tapent le nom ; 60 secondes ; barème de Devine la chanson) | fait |
| Où est-ce ? (carte du monde, choix du pays dans une liste, barème par distance jusqu'à 2 000 km ; données générées par `scripts/boum/generate-countries.mjs`, voir NOTICE.md) | fait |
| Modes restants : Devine la chanson, Le mot secret, Photo-défi, Grimace, Galerie du thème, Rythme, Son mystère, Imite le cri, Le plus fort, Qui fait ce bruit ? | à faire |
| Formats (équipes, championnat) et super-pouvoirs | à faire |
| Effets de mise en scène de l'écran principal | à faire |

Les contenus ne se tirent qu'après validation : une banque tout juste amorcée est à valider avant la première partie.
Un mode dont la banque validée est insuffisante est retiré du tirage ; la partie continue avec les autres.

## Banques de contenu

Chaque entrée a un type, un niveau (`doux`, `corsé`, `limite`), un texte, une réponse selon le type, un statut
(`propose`, `a_valider`, `valide`, `retire`). Seules les entrées `valide` sont tirées. Modifier le texte d'une entrée
`valide` la repasse en `a_valider`. La suppression est douce.

Le niveau `limite` n'existe que pour le pack Humour noir, et seulement pour les types qui l'autorisent.

### Import et export

Fichier UTF-8 (BOM accepté), une entrée par ligne, champs séparés par ` ; ` :

```
# Exemples
phrase_trous ; corsé ; Pour fêter sa retraite, le maire a fait exploser ___ avec ___.
question_chiffre ; doux ; Combien de km entre Paris et Lyon ? ; 390
pays_indice ; doux ; Sa capitale est Ottawa. ; CA
metier ; doux ; pompier
```

Limites : 300 Ko et 2 000 lignes au plus. Un fichier illisible n'importe rien ; une ligne fausse ne bloque pas les autres.
Chaque ligne refusée est signalée avec son numéro et sa raison. L'import est additif : rien n'est écrasé ni supprimé.
L'aperçu est obligatoire avant toute écriture.

### Contrôle des textes

Les textes sont relus par l'administrateur avant tout tirage. Le contrôle automatique ne refuse que les noms de jeux commerciaux.

## Musique et bruitages

Dans l'administration, « Musiques et bruitages » choisit un fichier de la médiathèque pour :

- la musique de l'accueil, celle des menus (rejoindre, profil, salon avant la partie) et celle de la fin de partie ;
- chacun des bruitages des jeux, qui remplace le son synthétisé d'origine.

Les musiques bouclent sans fin. Le volume (0 à 100 %, 50 % par défaut) se règle dans la même section.

Par défaut, la musique est coupée et les bruitages restent ceux d'origine. Chaque appareil joue la musique de la page
qu'il affiche. Le bouton muet coupe aussi la musique. Les téléphones ne jouent pas de musique de salon dans cette version.

## Vérification

```
npm test
npm run typecheck
npm run lint
```

Non vérifié à ce jour : son audible sur appareil, vibration sur iPhone, fréquence d'images de l'écran principal sur un
téléviseur modeste, comportement en HTTP sur le réseau local, carte Natural Earth (non intégrée).
