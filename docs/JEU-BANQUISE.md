# Banquise

Un jeu d'adresse en trois niveaux, sur une banquise qui fond. Chaque joueur contrôle son personnage depuis son
téléphone (ou un clavier, sur ordinateur). Le téléphone est la manette ; l'écran principal montre la banquise,
les personnages et le vent.

Identifiant : `banquise` · catégorie : plateau · 2 à 8 joueurs · environ 4 minutes · version 1.0.0.

## But

Rester sur la glace. Un joueur qui tombe à l'eau est éliminé pour la manche en cours. **Le dernier joueur resté sur
la glace gagne le niveau** et marque 100 points. Le jeu compte trois niveaux ; le total de points désigne le
vainqueur.

## Déroulé

Une partie enchaîne trois niveaux. Chaque niveau suit le même cycle :

1. **Compte à rebours** (3 secondes). Les personnages sont placés sur la glace, répartis sur la partie centrale
   (jamais à moins de 3 colonnes d'un bord, que la fonte emporte en premier). Les commandes sont ignorées pendant le
   compte.
2. **Jeu.** Le niveau s'arrête dès qu'il ne reste qu'un joueur sur la glace.
3. **Résultat** (4 secondes). L'écran principal annonce le gagnant et affiche l'ordre des éliminations.

Après le niveau 3, le classement final s'affiche.

### Niveau 1 : La fonte

- Une banquise pleine de 21 colonnes, sans trou.
- Trois secondes après le départ, la banquise commence à fondre : une colonne de glace disparaît toutes les
  1,6 seconde, du bord gauche ou du bord droit (au hasard). Les joueurs posés sur la colonne qui disparaît tombent.
- Le niveau finit quand la glace est épuisée au point de ne laisser qu'un joueur, ou plus de glace.
- Rester au centre ne suffit pas : la fonte finit par atteindre tout le monde.

### Niveau 2 : Les crevasses

- La banquise a entre 3 et 5 trous. Chaque trou fait 1 ou 2 colonnes.
- Entre deux trous, il reste au moins 2 colonnes de glace. Les trois colonnes des deux bords sont toujours pleines.
- Un trou de 2 colonnes se franchit en sautant en courant. Un trou de 3 colonnes serait trop large : le jeu n'en
  fabrique pas.
- Les joueurs tombent s'ils marchent dans un trou ou s'ils sont poussés dedans.
- La fonte commence après 45 secondes, puis une colonne disparaît toutes les 1,6 seconde. Elle empêche une
  manche de traîner sans fin.

### Niveau 3 : La tempête

- Même banquise que le niveau 2 (trous, fonte à 45 secondes).
- Des rafales de vent soufflent par intervalles, à gauche ou à droite, avec une intensité variable.
  - Calme de 3 à 5 secondes.
  - **Annonce** de 1,4 seconde : une flèche indique la direction de la prochaine rafale.
  - **Rafale** de 1,8 à 2,6 secondes, d'une force de 60 à 100 %.
- Vent et glace : un joueur immobile glisse dans le sens de la rafale. Un joueur qui marche ou saute y résiste en
  partie. En l'air, le vent dévie le saut.

## Victoire et points

- Le dernier joueur sur la glace gagne le niveau : **100 points**.
- Si tous les joueurs tombent au même tick du serveur (50 ms), tous ceux qui sont tombés à ce moment-là gagnent le
  niveau et reçoivent les 100 points.
- Le classement final additionne les trois niveaux. Deux joueurs à égalité partagent le même rang.

## Commandes

| Action                    | Téléphone (tactile)         | Clavier                |
| ------------------------- | --------------------------- | ---------------------- |
| Aller à gauche / à droite | touches ◀ et ▶ (maintenues) | flèches, ou A et D     |
| Sauter                    | bouton « Saut »             | Espace, flèche haut, W |
| Pousser                   | bouton « Pousser »          | E, Entrée ou X         |

- Une touche maintenue garde la direction. Relâcher la touche arrête le personnage (la glace glisse un peu, donc
  il continue sur quelques dizaines de centimètres).
- **Saut** : seulement au sol. Un saut dure environ 0,76 seconde, s'élève de 1,4 colonne et porte à environ 3,2 colonnes à pleine vitesse. Il faut donc partir entre 1,5 et 0,3 colonne avant un trou de 2 colonnes.
- **Pousser** : frappe le joueur qui est devant vous (dans le sens où vous regardez), à moins d'une colonne. Il glisse
  vers l'arrière. Délai de 1,2 seconde entre deux poussées.

## Physique (valeurs exactes)

Le serveur calcule tout. Le téléphone n'envoie que des intentions (direction, saut, poussée). Pas de tick réseau
client : la position est calculée toutes les 50 ms.

| Constante          | Valeur                           | Rôle                                                                       |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| `WIDTH`            | 21 colonnes                      | largeur de la banquise                                                     |
| `TICK_MS`          | 50 ms                            | pas de la simulation                                                       |
| `WALK_SPEED`       | 4,2 col/s                        | vitesse de marche                                                          |
| `ICE_ACCEL`        | 13 col/s²                        | accélération sur la glace                                                  |
| `ICE_DRAG`         | 2,0 /s                           | freinage quand on ne marche plus (glisse)                                  |
| `AIR_ACCEL`        | 6 col/s²                         | contrôle en l'air                                                          |
| `GRAVITY`          | 20 col/s²                        | pesanteur                                                                  |
| `JUMP_SPEED`       | 7,6 col/s                        | vitesse verticale au saut                                                  |
| `WIND_ACCEL`       | 5 col/s² × force (0,6 à 1)       | effet du vent                                                              |
| `PUSH_SPEED`       | 4,8 col/s                        | vitesse donnée au joueur poussé                                            |
| `PUSH_RANGE`       | 0,95 col devant, 0,7 de dénivelé | portée d'une poussée                                                       |
| `PUSH_COOLDOWN_MS` | 1 200 ms                         | délai entre deux poussées                                                  |
| `BODY_HALF`        | 0,35 col                         | demi-largeur d'un personnage (ils ne se traversent pas)                    |
| `FOOT`             | 0,3 col                          | écart des pieds : un personnage reste sur la glace si l'un des pieds l'est |
| `SINK_DEPTH`       | 0,6 col                          | profondeur à partir de laquelle le personnage est éliminé                  |

## Personnages

Le plan et les personnages suivent les niveaux 3D de Bomberman : pixel art, vue de trois quarts, mêmes sprites de couleur.
Chaque joueur a son sprite (sa couleur). Un personnage **importé avec des planches** (voir
`docs/PERSONNAGES-PACK.md`) remplace ce sprite : on affiche sa case « repos » (corps entier, face au joueur), comme sur
le plateau de Bomberman.

Le sprite suit le sens du regard (à gauche ou à droite) et rebondit d'un pixel à chaque pas. En l'air, il est dessiné
plus haut, avec son ombre au sol, plus petite. Éliminé, il disparaît dans l'eau (éclaboussure).

## Écrans

- **Plan** : une vue de trois quarts, légèrement écrasée. Chaque plaque de glace a un dessus clair au biseau asymétrique
  (lumière en haut à gauche, ombre en bas à droite) et une face avant plus sombre, visible dans l'écart qui sépare
  deux rangées. Les trous sont des cases creuses, avec leur paroi du fond dans l'ombre. La mer entoure la banquise,
  avec des reflets qui glissent et des trous de pions dans ses rangées extérieures.
- **Écran principal** : le plan, les personnages avec leur nom, le numéro du niveau et son titre, l'annonce du vent et
  ses traînées, le temps avant la fonte, les éliminés et le classement.
- **Téléphone** : le même plan en plus petit, votre personnage mis en évidence (« Vous »), les commandes en bas, et
  « Tombé à l'eau » après l'élimination.

## Robots (mode test)

Les robots suivent des règles simples : rester vers le centre, sauter avant un trou, pousser un adversaire placé
devant, et fuir le bord. Ils ne jouent pas bien (leur délai de réaction dépasse un saut), mais ils finissent
toujours une partie, car la fonte garantit la fin de chaque niveau.

## Tests

`packages/server/src/__tests__/banquise.test.ts` vérifie :

- la banquise de chaque niveau : sans trou au niveau 1 ; trous de 1 ou 2 colonnes, séparés par au moins 2 colonnes
  de glace, bords pleins au niveau 2 et 3 ;
- qu'un joueur qui court et saute franchit chaque trou généré, avec une marge de décollage d'au moins une colonne ;
- le saut seulement au sol, la poussée à portée et avec son délai ;
- la chute dans l'eau et l'élimination ;
- le vent : une rafale fait glisser un joueur immobile, le calme non ;
- la fin de niveau (dernier joueur, ou égalité au même tick), les points et le passage au niveau suivant ;
- une partie complète jouée par des robots, sur plusieurs graines, qui se termine.

## Ce qui reste à valider sur de vrais appareils

- la sensation des commandes sur un téléphone (les boutons doivent répondre sans délai perceptible) ;
- la lisibilité de la vue sur un petit écran en paysage et en portrait ;
- le réglage du vent et de la fonte après quelques parties réelles, à partir des constantes ci-dessus.
