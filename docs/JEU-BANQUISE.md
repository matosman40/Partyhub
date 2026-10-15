# Banquise

Un jeu d'adresse en trois niveaux, sur un îlot de glace qui fond. Chaque joueur contrôle son personnage depuis son
téléphone (ou un clavier, sur ordinateur). Le téléphone est la manette ; l'écran principal montre l'îlot, les
personnages et le vent.

Identifiant : `banquise` · catégorie : plateau · 2 à 8 joueurs · environ 4 minutes · version 1.0.0.

## But

Rester sur la glace. Un joueur qui tombe à l'eau est éliminé pour la manche en cours. **Le dernier joueur resté sur
la glace gagne le niveau** et marque 100 points. Le jeu compte trois niveaux ; le total de points désigne le
vainqueur.

## Déroulé

Une partie enchaîne trois niveaux. Chaque niveau suit le même cycle :

1. **Compte à rebours** (3 secondes). Les personnages sont placés sur la glace, en anneau autour du centre de l'îlot
   (jamais sur le bord, que la fonte emporte en premier). Les commandes sont ignorées pendant le compte.
2. **Jeu.** Le niveau s'arrête dès qu'il ne reste qu'un joueur sur la glace.
3. **Résultat** (4 secondes). L'écran principal annonce le gagnant et affiche l'ordre des éliminations.

Après le niveau 3, le classement final s'affiche.

### Niveau 1 : La fonte

- Un îlot plein et arrondi, de 81 cases hexagonales (une grille de 11 × 9 cases, dont le contour est tronqué pour
  faire un îlot rond), sans trou.
- Trois secondes après le départ, la banquise commence à fondre : une case du bord disparaît toutes les 1,6 seconde,
  choisie au hasard parmi les cases du contour. Les joueurs posés sur la case qui disparaît tombent.
- Quand une case disparaît et coupe l'îlot en deux, le morceau détaché fond aussi : il ne reste jamais qu'un seul
  morceau de glace.
- Le niveau finit quand la glace est épuisée au point de ne laisser qu'un joueur, ou plus de glace.
- Rester au centre ne suffit pas : la fonte finit par atteindre tout le monde.

### Niveau 2 : Les crevasses

- L'îlot a entre 1 et 12 cases d'eau à l'intérieur, en général 4 à 6 trous. Chaque trou fait une case, ou deux cases
  côte à côte. Les trous restent dans la partie centrale, loin du bord.
- Un trou qui couperait l'îlot en deux n'est pas gardé : l'îlot reste d'un seul tenant.
- On peut sauter au-dessus d'un trou de deux cases, ou le contourner.
- Les cases sont des hexagones à pointe en haut : chaque case a six voisins. Une case de glace reliée à ses voisins
  forme le morceau de l'île ; c'est sur ces voisinages que se mesurent la fonte et la continuité de l'île.
- Les joueurs tombent s'ils marchent dans un trou ou s'ils sont poussés dedans.
- La fonte commence après 45 secondes, puis une case disparaît toutes les 1,6 seconde. Elle empêche une manche de
  traîner sans fin.

### Niveau 3 : La tempête

- Même île que le niveau 2 (trous, fonte à 45 secondes).
- Des rafales de vent soufflent par intervalles, à gauche ou à droite, avec une intensité variable. Le vent ne souffle
  que de gauche à droite (sur l'axe horizontal).
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

| Action                | Téléphone (tactile)                  | Clavier                                       |
| --------------------- | ------------------------------------ | --------------------------------------------- |
| Marcher               | croix ▲ ◀ ▶ ▼ (maintenues)           | flèches, ou WASD (ZQSD sur clavier français)  |
| Sauter                | bouton « Saut »                      | Espace                                        |
| Pousser               | bouton « Pousser »                   | E, Entrée ou X                                |

- Marche dans les quatre directions de l'écran (gauche, droite, haut, bas). En diagonale, la vitesse reste la même que
  tout droit ; le personnage glisse librement sur les hexagones.
- Une touche maintenue garde la direction. Relâcher la touche arrête le personnage (la glace glisse un peu, donc
  il continue sur quelques dizaines de centimètres).
- **Saut** : seulement au sol. Un saut dure environ 0,76 seconde, s'élève de 1,4 case et porte à environ 3,2 cases à
  pleine vitesse. Il faut donc partir environ une case avant un trou de deux cases.
- **Pousser** : frappe le joueur qui est devant vous, dans le sens de votre dernier mouvement, à moins d'une case
  et à moins de 0,6 case de l'axe de la poussée. Il glisse dans ce sens. Délai de 1,2 seconde entre deux poussées.
  Si vous êtes resté immobile, la poussée part du dernier sens de marche.

## Physique (valeurs exactes)

Le serveur calcule tout. Le téléphone n'envoie que des intentions (direction, saut, poussée). Pas de tick réseau
client : la position est calculée toutes les 50 ms.

| Constante          | Valeur                           | Rôle                                                                       |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| `COLS` × `ROWS`    | 11 × 9 cases                     | taille de la grille hexagonale ; l'îlot est une ellipse dedans            |
| `ROW_H`            | √3/2 case                        | écart entre deux lignes d'hexagones ; une ligne sur deux est décalée d'une demi-case |
| `TICK_MS`          | 50 ms                            | pas de la simulation                                                       |
| `WALK_SPEED`       | 4,2 case/s                       | vitesse de marche (en diagonale, répartie entre les deux axes)             |
| `ICE_ACCEL`        | 13 case/s²                       | accélération sur la glace                                                  |
| `ICE_DRAG`         | 2,0 /s                           | freinage quand on ne marche plus (glisse)                                  |
| `AIR_ACCEL`        | 6 case/s²                        | contrôle en l'air                                                          |
| `GRAVITY`          | 20 case/s²                       | pesanteur                                                                  |
| `JUMP_SPEED`       | 7,6 case/s                       | vitesse verticale au saut                                                  |
| `WIND_ACCEL`       | 5 case/s² × force (0,6 à 1)      | effet du vent, sur l'axe horizontal                                        |
| `PUSH_SPEED`       | 4,8 case/s                       | vitesse donnée au joueur poussé                                            |
| `PUSH_RANGE`       | 0,95 case devant, 0,7 de dénivelé | portée d'une poussée                                                      |
| `PUSH_LATERAL`     | 0,6 case                         | écart maximal perpendiculaire à la poussée                                 |
| `PUSH_COOLDOWN_MS` | 1 200 ms                         | délai entre deux poussées                                                  |
| `BODY_HALF`        | 0,35 case                        | rayon d'un personnage (ils ne se traversent pas, dans les deux sens)       |
| `FOOT`             | 0,3 case                         | écart des pieds : un personnage reste sur la glace si l'un des pieds l'est |
| `SINK_DEPTH`       | 0,6 case                         | profondeur à partir de laquelle le personnage est éliminé                  |

## Personnages

Le plan et les personnages suivent les niveaux 3D de Bomberman : pixel art, vue de trois quarts, mêmes sprites de couleur.
Chaque joueur a son sprite (sa couleur). Un personnage **importé avec des planches** (voir
`docs/PERSONNAGES-PACK.md`) remplace ce sprite : on affiche sa case « repos » (corps entier, face au joueur), comme sur
le plateau de Bomberman.

Le sprite suit le sens du regard (à gauche ou à droite) et rebondit d'un pixel à chaque pas. Les personnages sont
dessinés du fond vers l'avant : celui qui est plus bas à l'écran passe devant. En l'air, il est dessiné plus haut, avec
son ombre au sol, plus petite. Éliminé, il disparaît dans l'eau (éclaboussure).

## Écrans

- **Plan** : une vue de trois quarts. L'îlot est une grille d'hexagones à pointe en haut. Chaque case de glace est un
  cube bleu : un dessus clair, une face avant à deux pans sous ses arêtes basses. Certaines cases ont une neige sur le
  dessus. Les trous sont des eaux noires avec leur paroi du fond dans l'ombre. La mer est profonde, avec des reflets
  qui dérivent, et des morceaux de banquise enneigés flottent autour du plan.
- **Écran principal** : le plan, les personnages avec leur nom, le numéro du niveau et son titre, l'annonce du vent et
  ses traînées, le temps avant la fonte, les éliminés et le classement.
- **Téléphone** : le même plan en plus petit, votre personnage mis en évidence (« Vous »), la croix de déplacement, Saut
  et Pousser en bas, et « Tombé à l'eau » après l'élimination.

## Robots (mode test)

Les robots suivent des règles simples : aller vers le centre de l'îlot, sauter avant un trou qui est devant eux,
pousser un adversaire placé devant, et fuir le bord. Ils ne jouent pas bien (leur délai de réaction dépasse un saut),
mais ils finissent toujours une partie, car la fonte garantit la fin de chaque niveau.

## Tests

`packages/server/src/__tests__/banquise.test.ts` vérifie :

- l'île de chaque niveau : sans trou au niveau 1 ; au niveau 2 et 3, des trous au centre, et l'île reste d'un seul
  tenant (voisinage hexagonal) ;
- les points de départ, en anneau, tous sur la glace et distincts ;
- l'érosion : une case de moins à chaque fonte, et un seul morceau de glace après ;
- qu'un personnage qui court sur la ligne du milieu saute deux trous de deux cases et atteint le bord opposé ;
- la vitesse de croisière en diagonale égale celle de la marche droite ;
- le saut seulement au sol, la chute hors de l'île et l'élimination ;
- le vent : une rafale fait glisser un joueur immobile sur l'axe horizontal, le calme non ;
- la poussée dans le sens du dernier mouvement, avec son délai, et refusée derrière soi ou sur le côté ;
- la séparation des personnages dans les deux directions ;
- la fin de niveau (dernier joueur, ou égalité au même tick), les points et le passage au niveau suivant ;
- une partie complète jouée par des robots, sur plusieurs graines, qui se termine.

## Ce qui reste à valider sur de vrais appareils

- la sensation de la croix de déplacement sur un téléphone (les boutons doivent répondre sans délai perceptible) ;
- la lisibilité de la vue sur un petit écran en paysage et en portrait ;
- le réglage de la taille de l'île, du vent et de la fonte après quelques parties réelles, à partir des constantes ci-dessus.
