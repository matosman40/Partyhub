# Plan : le magasin comme source unique des jeux

Statut : **validé** le 2026-11-05 pour les points 2 à 4, installation en ligne uniquement (point 1). Étape 1 à lancer.

## Objectif

Chaque jeu de PartyHub, intégré ou non, s'installe, se met à jour et se supprime depuis le magasin, avec une version,
une empreinte et une signature. Le cœur de PartyHub ne contient plus de code de jeu.

## Constat (état actuel)

- 29 jeux sont écrits dans `packages/games` et compilés dans le serveur et l'interface. Leurs vues React
  sont chargées avec le reste de l'application.
- Le magasin distribue déjà des paquets (`jeux-partyhub`) : une quarantaine de releases publiées, dont des
  jeux intégrés en double (`quiz-party` 1.1.2 du magasin contre le code intégré).
- Il existe deux formats de paquet utilisés : des paquets de données (questions, cartes, recettes, plateaux) et
  des jeux de code (bundle signé, exécuté dans une iframe, avec `codeView`).

## Approche proposée

1. **Un seul format pour la distribution** : le jeu de code signé (`kind: code`), qui existe déjà. Un jeu
   intégré est empaqueté : son module serveur et ses vues sont compilés en un bundle, signé à la publication.
2. **Vues dans une iframe**, comme les jeux de code actuels. Le contrat `GameClientViews` reste le même, mais
   il s'exécute dans l'iframe avec un pont de messages vers l'application. Pas de React partagé avec le cœur.
3. **Migration par étapes**, un groupe après l'autre :
   - étape 1 : la plomberie (build des bundles, signature, installation, mise à jour, rollback) et 3 jeux simples ;
   - étape 2 : les jeux de cartes et de plateau (déjà paramétrés par des presets) ;
   - étape 3 : les quiz et les jeux à IA (Quiz Party, Photo mystère, Aventure IA) ;
   - étape 4 : les derniers jeux, puis suppression du code intégré.
4. **Identifiants et données inchangés** : un jeu garde son identifiant, donc les salles, profils, scores et
   réglages existants restent valides.
5. **Premier lancement** : une installation neuve télécharge la sélection par défaut depuis le magasin.

## Points qui ont un coût

- **Hors ligne** : une installation sur réseau local sans Internet ne peut pas installer depuis le magasin.
  Il faut une archive « tout inclus » à importer à la main. C'est à trancher (voir plus bas).
- **Sécurité** : un jeu de code s'exécute dans une iframe. Il faut vérifier la signature à chaque
  installation et interdire tout accès réseau au-delà du pont.
- **Taille** : les jeux intégrés représentent plusieurs Mo de code. À mesurer avant de dimensionner l'archive.
- **Dépendances de l'IA** : Quiz Party, Photo mystère et Aventure IA utilisent des services du serveur (IA,
  images, médiathèque). Le pont doit exposer ces services, sans les laisser au jeu.
- **Retour arrière** : garder la version précédente d'un paquet, pour revenir en arrière si une mise à jour
  casse une salle en cours.

## Estimation

| Étape | Temps |
|---|---|
| Plomberie : build, signature, pont iframe, rollback | 5 à 7 jours |
| Étape 1 : 3 jeux simples | 2 jours |
| Étape 2 : cartes et plateau | 3 à 4 jours |
| Étape 3 : quiz et IA | 5 à 6 jours |
| Étape 4 : reste, nettoyage, tests de non-régression | 4 à 5 jours |
| **Total** | **environ 20 à 24 jours** |

## Décisions prises

1. **Installation en ligne uniquement** : pas d'archive hors ligne. Une installation sans Internet ne reçoit pas les jeux du magasin.
2. **Code intégré gardé en secours** pendant la migration, jusqu'à l'étape 4.
3. **Vues en iframe** : validé.
4. **Quiz Party** : la version du magasin remplace le code intégré à la fin de l'étape 3.
