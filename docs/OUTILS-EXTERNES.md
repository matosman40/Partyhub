# Outils externes à piocher

Ce document recense les dépôts GitHub ajoutés à la réflexion sur PartyHub, leur licence, ce qu'on peut en
prendre, et ce qui reste à décider. Vérifié le 2026-11-05 (licences et dates lues sur GitHub).

PartyHub est sous licence MIT. Une ressource n'entre dans le dépôt qu'avec sa licence compatible et sa mention
d'auteur. Rien de ce qui suit n'est encore copié dans le code.

## pixelfx (patch-gg/pixelfx)

- **Licence** : MIT. Auteur : Patch. Certains effets adaptent du code de Sprite Fusion (MIT) et de Hollow Crown
  (MIT) : leurs mentions sont dans `NOTICE.md` du dépôt et doivent être reprises avec le code.
- **Contenu** : 244 effets de pixel art en JavaScript (feu, explosions, magie, météo, coups, petites bêtes),
  chacun dans un fichier `src/fx/<catégorie>/`. Le noyau de rendu est dans `src/core/`.
- **Pour PartyHub** : des effets prêts pour les victoires, défaites, impacts et explosions de nos jeux (Boum,
  Sauteurs, Micro-défis, Gags en rafale), et pour les écrans de fin.
- **Usage prévu** : piocher un effet à la fois au besoin, le copier dans `packages/web/src/fx/pixelfx/` avec son
  en-tête d'origine et la mention MIT. Pas de dépendance npm, pas de copie en masse.
- **À vérifier avant d'utiliser un effet** : le fichier doit tourner sur canevas, sans bibliothèque externe, et
  sa taille doit rester raisonnable pour un téléphone.

## lemo-opuscar (lemomo-ai/lemo-opuscar)

- **Licence** : MIT pour le code, CC BY 4.0 pour les contenus (styles et films de démonstration). Toute
  utilisation d'un film du dépôt impose une mention d'auteur (Lemomo) et un lien vers la licence.
- **Contenu** : une boîte à outils de styles de films, faits uniquement en code. Un style est un prompt de style
  plus un film de démonstration. Un plugin Claude Code (`plugin/skills/lemo-opuscar/`) pilote la fabrication.
- **Prérequis** : Node 20 ou plus, ffmpeg 7 ou plus (ffmpeg 6.1 d'Ubuntu 24.04 est trop ancien), Python 3.11 ou plus.
  La fabrication d'un film passe par Claude Opus 5.5 : elle a un coût en tokens à chaque film.
- **Pour PartyHub** : produire des petits films, par exemple une scène de victoire ou de défaite, pour chaque
  personnage jouable, puis les lire automatiquement selon le personnage choisi par le joueur.

### Proposition de mise en œuvre (non commencée)

1. Définir la liste des personnages jouables (identifiants stables) et les deux issues (victoire, défaite).
2. Fabriquer un film par couple (personnage, issue) avec un style de la bibliothèque, hors du jeu, sur une
   machine de travail, et noter le coût.
3. Déposer les films dans `packages/web/public/films/` et un fichier de correspondance
   (`personnage -> fichier`), vérifié par un test.
4. Côté jeu : le téléphone et l'écran principal lisent le fichier du personnage choisi. Sans fichier, on affiche
   l'image de secours existante.

Points à décider : le style, la durée, la taille totale (un film de 1080p pèse plusieurs mégaoctets : quinze
personnages et deux issues représentent plusieurs dizaines de Mo), et le coût de fabrication.

## Écartés

- **lemo-wake** (lemomo-ai/lemo-wake) : licence CC BY-NC 4.0, qui interdit l'usage commercial. Écarté, faute de cadre clair pour PartyHub. À reconsidérer seulement si la licence change ou si l'auteur accorde une autre licence.

## Ce qui reste ouvert

- pixelfx : aucune copie faite. Attendre une demande d'effet précis.
- lemo-opuscar : plan ci-dessus, en attente de validation (coût et taille).
