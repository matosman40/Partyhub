# PartyHub — direction artistique

## Sujet et usage

Une soirée entre amis, salon à la lumière basse. La TV ou l'ordinateur est le centre de la pièce ;
les téléphones sont des manettes. Trois sujets concrets pèsent sur le design :

- on lit l'écran principal à trois mètres : tout ce qui compte doit être gros et contrasté ;
- on tient un téléphone d'une main : les cibles tactiles sont larges, les actions sont en bas ;
- les gens arrivent en retard : la salle doit se rejoindre en une seconde (code, QR, prénom).

## Plan (première passe)

**Concept : affiche de soirée imprimée en risographie.** Deux encres superposées sur du papier,
trame de points (halftone), décalage de repérage (misregistration) sur les titres. Ce n'est ni le
néon violet ni le « carton SaaS » : l'objet visuel est une affiche collée au mur.

Couleurs (quatre encres et deux fonds, nommés) :

| Rôle       | Nom           | Hex       |
| ---------- | ------------- | --------- |
| Papier     | papier-froid  | `#ECEAE3` |
| Encre      | encre-marine  | `#1B1A4B` |
| Accent 1   | rose-fluo     | `#FF4F8B` |
| Accent 2   | bleu-outremer | `#3247E0` |
| Accent 3   | jaune-soleil  | `#FFD23F` |
| Nuit (sombre) | nuit-encre | `#14122E` |

Typographie : **une seule famille, Archivo** (variable, axes de graisse et de chasse). Titres
en chasse condensée (62 à 75 %) et graisse 900 ; texte courant en chasse normale. Échelle :
15 / 17 / 22 / 30 / 44 / 64 / 96 px sur TV. Pas de capitales forcées sur les étiquettes.

Mise en page : texte aligné à gauche sur une grille de poster ; les écrans de jeu (TV) sont
centrés sur leur zone de jeu. Blocs de couleur plats, filets encre de 2 px, rayons faibles (4 px).
Trame de points en fond, très légère.

Élément mémorable (un seul) : le logo et les grands titres de page ont un décalage de repérage
(une seconde couleur décalée de quelques pixels). Une seule animation d'entrée : les deux encres
se mettent en registre au chargement de l'accueil.

## Revue du plan avant construction

Relecture contre les réflexes génériques :

- *Crème + terracotta* : écarté. Le papier est froid et l'accent n'est pas terracotta.
- *Noir + vert fluo* : écarté. Le fond sombre est un bleu-marine encre, pas un noir.
- *Cartes SaaS identiques* : remplacées par des « tickets » de jeu aux couleurs propres à chaque
  jeu ; pas de cartes aux ombres grises ni de dégradés décoratifs.
- *Étiquette en capitales au-dessus de chaque titre* : supprimée. Les catégories sont des puces
  en minuscules.
- *Numérotation décorative* : réservée aux notices, où les étapes sont réellement séquentielles.
- *Fondu sur chaque section* : supprimé. Une seule entrée orchestrée sur l'accueil.
- *Flèche « → » sur les boutons* : supprimée.

Révision faite : la première version proposait un fond sombre violet avec dégradés, qui ressemble
à tout gabarit de jeu. Remplacée par l'encre marine et la trame de points.

## Règles

1. Une encre pour le texte, une pour l'action principale, une pour le détail. Pas plus de deux
   accents sur un même écran.
2. Le texte est en phrases, verbes à l'actif : « Créer la salle », « Essayer seul ».
3. Les erreurs disent quoi faire : « Ce pseudo est déjà pris. Choisissez-en un autre. »
4. Le mouvement répond à une action (ouvrir, valider, marquer un point). Respect de
   `prefers-reduced-motion`.
5. Focus clavier visible, contraste AA minimum, cibles tactiles de 44 px minimum.
